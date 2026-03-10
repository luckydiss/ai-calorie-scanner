from __future__ import annotations

from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg.rows import dict_row

from .config import Settings


def _split_sql(script: str) -> list[str]:
    chunks = [chunk.strip() for chunk in script.split(";")]
    return [chunk for chunk in chunks if chunk]


class DBConnection:
    def __init__(self, raw_conn: Any):
        self.raw = raw_conn

    def _query(self, query: str) -> str:
        return query.replace("?", "%s")

    def execute(self, query: str, params: tuple[Any, ...] | list[Any] = ()):
        return self.raw.execute(self._query(query), params)

    def executescript(self, script: str) -> None:
        for stmt in _split_sql(script):
            self.raw.execute(stmt)

    def commit(self) -> None:
        self.raw.commit()

    def rollback(self) -> None:
        self.raw.rollback()

    def close(self) -> None:
        self.raw.close()


def connect(settings: Settings) -> DBConnection:
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required. SQLite runtime was removed.")
    raw = psycopg.connect(settings.database_url, row_factory=dict_row)
    return DBConnection(raw)


def init_db(conn: DBConnection) -> None:
    conn.execute("SELECT 1").fetchone()
    alembic_row = conn.execute("SELECT to_regclass('public.alembic_version') AS t").fetchone()
    if not alembic_row or not alembic_row.get("t"):
        raise RuntimeError(
            "Database is not migrated. Run: alembic -c alembic.ini upgrade head"
        )


@contextmanager
def transaction(conn: DBConnection):
    try:
        yield
        conn.commit()
    except Exception:
        conn.rollback()
        raise
