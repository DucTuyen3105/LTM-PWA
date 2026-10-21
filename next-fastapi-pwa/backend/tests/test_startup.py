import asyncio
from unittest.mock import AsyncMock, Mock

import psycopg
import pytest
from app import main


def test_startup_recovers_from_temporary_database_failure(monkeypatch):
    initialize = Mock(side_effect=[psycopg.OperationalError('DNS temporary failure'), None])
    sleep = AsyncMock()
    monkeypatch.setattr(main, 'initialize', initialize)
    monkeypatch.setattr(main.asyncio, 'sleep', sleep)
    asyncio.run(main.initialize_with_retry(attempts=3))
    assert initialize.call_count == 2
    sleep.assert_awaited_once_with(2)


def test_startup_stops_after_retry_limit(monkeypatch):
    initialize = Mock(side_effect=psycopg.OperationalError('No database'))
    sleep = AsyncMock()
    monkeypatch.setattr(main, 'initialize', initialize)
    monkeypatch.setattr(main.asyncio, 'sleep', sleep)
    with pytest.raises(psycopg.OperationalError):
        asyncio.run(main.initialize_with_retry(attempts=3))
    assert initialize.call_count == 3
    assert sleep.await_count == 2


def test_programming_errors_are_not_retried(monkeypatch):
    initialize = Mock(side_effect=ValueError('Bad configuration'))
    monkeypatch.setattr(main, 'initialize', initialize)
    with pytest.raises(ValueError):
        asyncio.run(main.initialize_with_retry())
    initialize.assert_called_once()
