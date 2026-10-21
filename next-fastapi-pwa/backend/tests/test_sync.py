"""Integration tests against a real PostgreSQL database (isolated random schema)."""
import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from app import main


@pytest.fixture
def client(monkeypatch):
    url = os.getenv('TEST_DATABASE_URL')
    if not url:
        pytest.skip('Set TEST_DATABASE_URL to run PostgreSQL integration tests')
    schema = 'test_' + uuid4().hex
    with psycopg.connect(url, autocommit=True) as db:
        db.execute(f'CREATE SCHEMA {schema}')
    def isolated_connect():
        return psycopg.connect(url, options=f'-c search_path={schema}', row_factory=main.dict_row)
    monkeypatch.setattr(main, 'connect', isolated_connect)
    try:
        with TestClient(main.app) as test_client:
            yield test_client
    finally:
        with psycopg.connect(url, autocommit=True) as db:
            db.execute(f'DROP SCHEMA {schema} CASCADE')


def mutation(**updates):
    return dict(mutationId=str(uuid4()), taskId=str(uuid4()), baseVersion=0,
                title='Học sync', completed=False, deleted=False, **updates)


def test_create_replay_update_delete_and_pull(client):
    first = mutation()
    response = client.post('/sync/push', json=first)
    assert response.status_code == 200
    assert response.json()['task']['version'] == 1
    assert client.post('/sync/push', json=first).json() == response.json()
    updated = {**first, 'mutationId': str(uuid4()), 'baseVersion': 1, 'completed': True}
    assert client.post('/sync/push', json=updated).json()['task']['version'] == 2
    deleted = {**updated, 'mutationId': str(uuid4()), 'baseVersion': 2, 'deleted': True}
    assert client.post('/sync/push', json=deleted).json()['task']['version'] == 3
    tasks = client.get('/tasks').json()['tasks']
    assert len(tasks) == 1 and tasks[0]['deleted'] is True


def test_conflict_and_explicit_resolution(client):
    first = mutation()
    client.post('/sync/push', json=first)
    stale = {**first, 'mutationId': str(uuid4()), 'title': 'Offline edit'}
    response = client.post('/sync/push', json=stale)
    assert response.status_code == 409
    assert response.json()['detail']['server']['version'] == 1
    resolved = {**stale, 'mutationId': str(uuid4()), 'baseVersion': 1}
    assert client.post('/sync/push', json=resolved).json()['task']['title'] == 'Offline edit'


def test_mutation_id_cannot_change_payload(client):
    first = mutation()
    client.post('/sync/push', json=first)
    assert client.post('/sync/push', json={**first, 'title': 'Different'}).status_code == 409
    assert client.get('/tasks').json()['tasks'][0]['title'] == first['title']


def test_concurrent_writers_only_one_wins(client):
    first = mutation()
    client.post('/sync/push', json=first)
    writes = [{**first, 'mutationId': str(uuid4()), 'baseVersion': 1, 'title': str(i)} for i in range(2)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        codes = list(pool.map(lambda body: client.post('/sync/push', json=body).status_code, writes))
    assert sorted(codes) == [200, 409]
    assert client.get('/tasks').json()['tasks'][0]['version'] == 2


def test_validation(client):
    assert client.post('/sync/push', json={**mutation(), 'title': ''}).status_code == 422
    assert client.post('/sync/push', json={**mutation(), 'baseVersion': -1}).status_code == 422
