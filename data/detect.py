"""Run every detection rule over a whole run in ClickHouse and report per rule:
rows scanned, events flagged, server-side execution time, and agreement with
the stored verdicts. With --write-latency, each flagged event's
detect_latency_ms is set to its rule's measured execution time (the honest MTTD).

  python detect.py --run-id run_demo [--write-latency]
"""

import argparse
import pathlib
import time

from ch import DB, query, sql_file

RULES_DIR = pathlib.Path(__file__).resolve().parent / "clickhouse" / "detection"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--write-latency", action="store_true")
    a = ap.parse_args()
    p = {"run": a.run_id}

    total, _ = query(f"SELECT count() FROM {DB}.events WHERE run_id = {{run:String}}", p)
    print(f"run {a.run_id}: {int(total):,} events\n")
    print(f"{'rule':<20}{'flagged':>11}{'stored':>11}{'agree':>8}{'exec ms':>9}{'rows read':>13}")
    timings = {}
    for f in sorted(RULES_DIR.glob("*.sql")):
        rule, body = f.stem, sql_file(f)
        t0 = time.time()
        n, summary = query(f"SELECT count() FROM ({body}) SETTINGS use_query_cache = 0", p)
        ms = int(summary.get("elapsed_ns", 0)) / 1e6 or (time.time() - t0) * 1000
        timings[rule] = ms
        check, _ = query(
            f"""SELECT countIf(rule = '{rule}'),
                       countIf(rule = '{rule}' AND seq IN (SELECT seq FROM ({body})))
                FROM {DB}.events WHERE run_id = {{run:String}}""", p)
        stored, both = map(int, check.split())
        flagged = int(n)
        agree = 100.0 * both / max(stored, flagged, 1)
        print(f"{rule:<20}{flagged:>11,}{stored:>11,}{agree:>7.1f}%{ms:>9.1f}{int(summary.get('read_rows', 0)):>13,}")

    if a.write_latency:
        for rule, ms in timings.items():
            query(f"ALTER TABLE {DB}.events UPDATE detect_latency_ms = {max(1, round(ms))} "
                  f"WHERE run_id = {{run:String}} AND rule = '{rule}'", p)
        print("\ndetect_latency_ms updated (mutation runs in the background)")


if __name__ == "__main__":
    main()
