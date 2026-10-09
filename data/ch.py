"""Tiny ClickHouse HTTP client (stdlib only). Reads CLICKHOUSE_* from the repo-root .env."""

import base64
import gzip
import json
import os
import pathlib
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent


def load_env(path=ROOT / ".env"):
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


load_env()
URL = os.environ.get("CLICKHOUSE_URL", "http://localhost:8123").rstrip("/")
DB = os.environ.get("CLICKHOUSE_DATABASE", "ghost")
_AUTH = "Basic " + base64.b64encode(
    f"{os.environ.get('CLICKHOUSE_USER', 'default')}:{os.environ.get('CLICKHOUSE_PASSWORD', '')}".encode()
).decode()


def query(sql, params=None, body=None, gz=False, timeout=600):
    """Run SQL. If `body` is given, SQL goes in the URL and `body` is the data (inserts).
    Returns (text, summary_dict) where summary is the X-ClickHouse-Summary header."""
    qs = {f"param_{k}": v for k, v in (params or {}).items()}
    headers = {"Authorization": _AUTH}
    if body is None:
        data = sql.encode()
    else:
        qs["query"] = sql
        data = body if isinstance(body, bytes) else body.encode()
        if gz:
            data = gzip.compress(data, compresslevel=3)
            headers["Content-Encoding"] = "gzip"
    url = URL + "/?" + urllib.parse.urlencode(qs) if qs else URL + "/"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            summary = json.loads(r.headers.get("X-ClickHouse-Summary") or "{}")
            return r.read().decode(), summary
    except urllib.error.HTTPError as e:
        raise RuntimeError(e.read().decode()[:1000]) from None


def sql_file(path):
    """Read a .sql file, dropping `--` comment lines."""
    return "\n".join(l for l in pathlib.Path(path).read_text(encoding="utf-8").splitlines() if not l.strip().startswith("--"))
