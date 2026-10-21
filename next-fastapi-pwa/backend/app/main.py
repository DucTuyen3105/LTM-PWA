"""Demo shared workspace: PostgreSQL is authoritative; all writes use versions."""
import os
import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://todo:todo@localhost:5432/todo')


def connect():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row, connect_timeout=5)


def initialize():
    with connect() as db:
        db.execute('''CREATE TABLE IF NOT EXISTS tasks (
            id UUID PRIMARY KEY, title TEXT NOT NULL, completed BOOLEAN NOT NULL,
            deleted BOOLEAN NOT NULL DEFAULT FALSE, version INTEGER NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL)''')
        db.execute('''CREATE TABLE IF NOT EXISTS mutations (
            id UUID PRIMARY KEY, payload JSONB NOT NULL, result JSONB NOT NULL)''')


async def initialize_with_retry(attempts=10, delay=2):
    for attempt in range(1, attempts + 1):
        try:
            await asyncio.to_thread(initialize)
            return
        except psycopg.OperationalError as error:
            if attempt == attempts:
                logging.exception('Database unavailable after %s attempts. Check db container and Compose network.', attempts)
                raise
            logging.warning('Database connection failed (%s); retry %s/%s in %ss', error, attempt, attempts, delay)
            await asyncio.sleep(delay)


@asynccontextmanager
async def lifespan(app):
    await initialize_with_retry()
    yield


app = FastAPI(title='Offline Todo Sync Demo', lifespan=lifespan)
app.add_middleware(CORSMiddleware,
    allow_origins=['http://localhost:3000', 'http://127.0.0.1:3000',
                   'http://172.18.0.1:3000'],
    allow_methods=['GET', 'POST'], allow_headers=['Content-Type'])


class Mutation(BaseModel):
    mutationId: UUID
    taskId: UUID
    baseVersion: int = Field(ge=0)
    title: str = Field(min_length=1, max_length=200)
    completed: bool = False
    deleted: bool = False


def serialize(row):
    return dict(id=str(row['id']), title=row['title'], completed=row['completed'],
                deleted=row['deleted'], version=row['version'],
                updatedAt=row['updated_at'].isoformat())


@app.get('/health')
def health():
    with connect() as db:
        db.execute('SELECT 1')
    return {'status': 'ok'}


@app.get('/tasks')
def pull():
    # Full snapshot, including tombstones. No cursor gaps or missed deletions.
    with connect() as db:
        rows = db.execute('SELECT * FROM tasks ORDER BY updated_at DESC, id').fetchall()
    return {'tasks': [serialize(row) for row in rows]}


@app.post('/sync/push')
def push(change: Mutation):
    payload = change.model_dump(mode='json')
    with connect() as db:
        # Demo-sized serialization: check version, write, and remember mutation
        # are one transaction. Concurrent clients cannot both win baseVersion=N.
        db.execute('SELECT pg_advisory_xact_lock(424242)')
        previous = db.execute('SELECT * FROM mutations WHERE id=%s',
                              (change.mutationId,)).fetchone()
        if previous:
            if previous['payload'] != payload:
                raise HTTPException(409, 'mutationId reused with a different payload')
            return previous['result']
        row = db.execute('SELECT * FROM tasks WHERE id=%s', (change.taskId,)).fetchone()
        if (row['version'] if row else 0) != change.baseVersion:
            # Conflict is not cached: user can explicitly retry against new version.
            raise HTTPException(409, detail={'server': serialize(row) if row else None})
        now = datetime.now(timezone.utc)
        row = db.execute('''INSERT INTO tasks (id,title,completed,deleted,version,updated_at)
            VALUES (%s,%s,%s,%s,1,%s)
            ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,
            completed=EXCLUDED.completed, deleted=EXCLUDED.deleted,
            version=tasks.version+1, updated_at=EXCLUDED.updated_at RETURNING *''',
            (change.taskId, change.title, change.completed, change.deleted, now)).fetchone()
        result = {'task': serialize(row)}
        db.execute('INSERT INTO mutations (id,payload,result) VALUES (%s,%s,%s)',
                   (change.mutationId, Jsonb(payload), Jsonb(result)))
    # Context manager has committed before success is returned.
    return result
