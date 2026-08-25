"""PostgreSQL 只读查询助手（Live 轨）。

对齐 agent-loop-project `app/data/pg_client.py` 的连接与参数化约定：
SQL 里用 `:name` 占位（自动转 psycopg `%(name)s`，保留 `::` 类型转换）。
"""

from __future__ import annotations

import re
from typing import Any

import psycopg
from psycopg.rows import dict_row

from app.config import Settings

_NAMED_PARAM = re.compile(r"(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)")


def _to_psycopg_sql(sql: str) -> str:
    return _NAMED_PARAM.sub(r"%(\1)s", sql)


def read_pg_rows(
    settings: Settings,
    sql: str,
    params: dict[str, Any] | None = None,
    *,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """执行只读查询，返回 dict 行列表。

    无 PG_DSN 或查询失败抛异常，由上层决定降级（demo fallback / 报错）。
    """
    if not settings.pg_dsn:
        raise RuntimeError("PG_DSN 未配置")

    bounded_sql = sql.strip().rstrip(";")
    if re.search(r"\blimit\b", bounded_sql, re.I) is None and limit > 0:
        bounded_sql = f"{bounded_sql} LIMIT {int(limit)}"
    bounded_sql = _to_psycopg_sql(bounded_sql)

    with psycopg.connect(
        settings.pg_dsn,
        row_factory=dict_row,
        connect_timeout=8,
        options="-c statement_timeout=15000",
    ) as conn:
        with conn.cursor() as cur:
            cur.execute(bounded_sql, params or {})
            rows = cur.fetchall()
    return [dict(row) for row in rows]
