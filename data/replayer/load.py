"""Bulk-load synthetic events into ghost.events (gzip JSONEachRow, parallel batches).

  python load.py --run-id run_hist --rows 1000000            # append
  python load.py --run-id run_hist --rows 1000000 --replace  # drop that run first
"""

import argparse
import concurrent.futures as cf
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from ch import DB, query  # noqa: E402
from generate import events  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--rows", type=int, default=1_000_000)
    ap.add_argument("--hours", type=float, default=24.0)
    ap.add_argument("--batch", type=int, default=100_000)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--replace", action="store_true", help="drop this run_id's partition first")
    a = ap.parse_args()

    if a.replace:
        query(f"ALTER TABLE {DB}.events DROP PARTITION {{run:String}}", {"run": a.run_id})
        print(f"dropped run {a.run_id}")

    insert = f"INSERT INTO {DB}.events FORMAT JSONEachRow"
    t0, sent, buf, pending = time.time(), 0, [], set()
    with cf.ThreadPoolExecutor(a.workers) as pool:
        def ship(lines):
            nonlocal pending
            if len(pending) >= a.workers * 2:  # bound memory: wait for one batch to land
                done, pending = cf.wait(pending, return_when=cf.FIRST_COMPLETED)
                for f in done:
                    f.result()
            pending.add(pool.submit(query, insert, body="\n".join(lines), gz=True))

        for row in events(a.run_id, a.rows, a.hours, seed=a.seed):
            buf.append(json.dumps(row))
            if len(buf) >= a.batch:
                ship(buf)
                sent += len(buf)
                buf = []
                print(f"  {sent:>12,} rows  {sent / (time.time() - t0):>9,.0f} rows/s", flush=True)
        if buf:
            ship(buf)
            sent += len(buf)
        for f in cf.as_completed(pending):
            f.result()

    total, _ = query(f"SELECT count() FROM {DB}.events WHERE run_id = {{run:String}}", {"run": a.run_id})
    print(f"loaded {sent:,} rows in {time.time() - t0:.1f}s; run {a.run_id} now has {int(total):,} rows")


if __name__ == "__main__":
    main()
