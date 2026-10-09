"""Synthetic GHOST events, shaped like the coordinator's ClickHouse row.

Events come in *campaigns*: one source (unique src_ip) running one persona for a
few seconds. Each campaign is either loud (trips a rule) or quiet (slips past).
Stored `detected`/`rule` are computed with exactly the logic of the SQL rules in
../clickhouse/detection/, so ClickHouse re-derives the same verdicts:

  signature rules -> payload label starts with 'sig:' (quiet ones use 'evasive:')
  windowed rules  -> same (src_ip, toStartOfInterval) buckets and thresholds

Payloads are opaque labels (e.g. 'sig:sqli_tautology'), not real attack strings.

Usage:  python generate.py --run-id run_hist --rows 1000 > events.ndjson
"""

import argparse
import datetime as dt
import json
import random
import sys

# ---- rules (keep in sync with ../clickhouse/detection/*.sql) -----------------
SIGNATURE_RULE = {"injection": "sqli_signature", "auth_bypass": "auth_bypass", "logic_abuse": "logic_anomaly"}
WINDOWS = {  # persona -> (rule, bucket seconds, "count" | "breadth", threshold)
    "dos": ("dos_flood", 1, "count", 50),
    "recon": ("recon_sweep", 10, "breadth", 8),
    "netscan": ("netscan_portsweep", 10, "breadth", 10),
}

AGENT = {"recon": "agent-1", "netscan": "agent-2", "injection": "agent-3",
         "auth_bypass": "agent-4", "dos": "agent-5", "logic_abuse": "agent-6"}
DAMAGE = {"info": 0, "low": -3, "medium": -8, "high": -15, "critical": -30}

# persona -> campaign weight (dos campaigns are rare but huge)
CAMPAIGN_WEIGHTS = {"recon": 20, "netscan": 15, "injection": 30, "auth_bypass": 20, "logic_abuse": 15, "dos": 3}

LABELS = {  # persona -> (detectable labels, evasive labels, components, severities)
    "injection": (["sqli_tautology", "sqli_union", "xss_reflected", "prompt_override"],
                  ["sqli_encoded", "sqli_comment_split", "xss_svg_handler", "prompt_indirect"],
                  ["/api/search", "/api/login", "/api/support/chat", "/api/products"],
                  ["high", "critical"]),
    "auth_bypass": (["jwt_unsigned", "idor_query_param", "role_param_escalation"],
                    ["jwt_weak_secret", "idor_path_segment", "header_identity_spoof"],
                    ["/api/accounts", "/api/users/profile", "/api/admin", "/api/auth/token"],
                    ["high", "critical"]),
    "logic_abuse": (["negative_quantity", "coupon_stacking"],
                    ["refund_race", "price_tamper", "rounding_drift"],
                    ["/api/cart", "/api/checkout", "/api/refund", "/api/transfer"],
                    ["medium", "high"]),
}
RECON_PATHS = [f"/{p}" for p in (
    "admin", "api", "api/v1", "api/v2", "debug", "metrics", "health", "status", "login", "logout",
    "register", "graphql", "swagger.json", "openapi.json", ".env", ".git/HEAD", "backup", "config",
    "internal", "actuator", "console", "static", "uploads", "api/users", "api/accounts", "api/search",
    "api/cart", "api/checkout", "api/refund", "api/support/chat", "robots.txt", "sitemap.xml")]
SENSITIVE_PORTS = [5432, 6379, 9200, 27017, 9000, 8123]
PORTS = [21, 22, 25, 53, 80, 110, 143, 443, 3000, 3306, 5000, 5432, 5601, 6379, 8000, 8080, 8123,
         8443, 9000, 9090, 9200, 11211, 27017]


def ip_for(n):
    return f"10.{(n >> 16) & 255}.{(n >> 8) & 255}.{n & 255}"


def _ev(t, persona, component, etype, severity, payload, status, desc):
    return {"t": t, "persona": persona, "component": component, "event_type": etype,
            "severity": severity, "payload": payload, "http_status": status, "description": desc}


def campaign(rng, persona, t0):
    """One campaign's raw events (no verdicts yet). t0 = start, epoch seconds (float)."""
    ev = []
    if persona in LABELS:
        good, quiet, comps, sevs = LABELS[persona]
        loud = rng.random() < 0.85
        t = t0
        for _ in range(rng.randint(2, 12)):
            t += rng.uniform(0.05, 1.5)
            label = ("sig:" if loud else "evasive:") + rng.choice(good if loud else quiet)
            hit = rng.random() < 0.3
            ev.append(_ev(t, persona, rng.choice(comps), "weakness_found" if hit else "attack_result",
                          rng.choice(sevs), label, rng.choice([200, 500]) if hit else rng.choice([400, 403, 404]),
                          f"{persona}: {label} {'succeeded' if hit else 'held'}"))
    elif persona == "dos":
        if rng.random() < 0.7:  # flood: well above threshold
            rate, secs = rng.randint(80, 400), rng.randint(1, 3)
        else:  # low-and-slow: stays under threshold per second
            rate, secs = rng.randint(5, 40), rng.randint(5, 30)
        comp = rng.choice(["/api/search", "/api/login", "/api/products", "/"])
        for i in range(rate * secs):
            t = t0 + i / rate
            ev.append(_ev(t, persona, comp, "attack_result", "low", "flood:request",
                          rng.choice([200, 429, 503]), f"dos: request burst on {comp}"))
        ev[-1].update(event_type="weakness_found", severity="high", http_status=503,
                      description=f"dos: {comp} degraded under load")
    else:  # recon / netscan: breadth sweeps
        fast = rng.random() < 0.7
        if persona == "recon":
            n = rng.randint(12, 32) if fast else rng.randint(3, 6)
            targets = rng.sample(RECON_PATHS, n)
        else:
            n = rng.randint(14, len(PORTS)) if fast else rng.randint(2, 6)
            targets = [f"tcp/{p}" for p in rng.sample(PORTS, n)]
        t = t0
        for tgt in targets:
            t += rng.uniform(0.05, 0.4) if fast else rng.uniform(12, 40)
            exposed = (persona == "netscan" and int(tgt[4:]) in SENSITIVE_PORTS) or \
                      (persona == "recon" and tgt in ("/admin", "/debug", "/.env", "/.git/HEAD", "/actuator"))
            ev.append(_ev(t, persona, tgt, "weakness_found" if exposed and rng.random() < 0.5 else "attack_result",
                          "high" if exposed else ("info" if persona == "recon" else "low"),
                          f"probe:{persona}", 200 if exposed else rng.choice([404, 403, 0]),
                          f"{persona}: probed {tgt}"))
    return ev


def verdicts(persona, ev):
    """Return a list of rule names ('' = missed), same logic as the SQL rules."""
    if persona in SIGNATURE_RULE:
        rule = SIGNATURE_RULE[persona]
        return [rule if e["payload"].startswith("sig:") else "" for e in ev]
    rule, secs, kind, thr = WINDOWS[persona]
    buckets = {}
    for e in ev:  # src_ip is unique per campaign, so bucket on time only
        b = e["ms"] // (secs * 1000)
        buckets.setdefault(b, []).append(e)
    flagged = set()
    for b, es in buckets.items():
        size = len(es) if kind == "count" else len({e["component"] for e in es})
        if size >= thr:
            flagged.add(b)
    return [rule if e["ms"] // (secs * 1000) in flagged else "" for e in ev]


def mean_campaign_size(rng, samples=3000):
    personas, weights = zip(*CAMPAIGN_WEIGHTS.items())
    return sum(len(campaign(rng, rng.choices(personas, weights)[0], 0.0)) for _ in range(samples)) / samples


def events(run_id, rows, hours=24.0, seq_start=1_000_000_000, seed=7, end=None):
    """Yield contract-shaped rows (dicts) until `rows` are produced."""
    rng = random.Random(seed)
    personas, weights = zip(*CAMPAIGN_WEIGHTS.items())
    span = hours * 3600
    gap = span / max(1.0, rows / mean_campaign_size(random.Random(seed + 1)))
    end = end or dt.datetime.now(dt.timezone.utc).timestamp() - 120
    t, seq, n_campaign, health, produced = end - span, seq_start, 0, 100, 0
    while produced < rows:
        t += rng.expovariate(1 / gap)
        persona = rng.choices(personas, weights)[0]
        ev = campaign(rng, persona, t)
        for e in ev:  # integer ms: identical bucketing to ClickHouse's DateTime64(3)
            e["ms"] = int(e["t"] * 1000)
        rules = verdicts(persona, ev)
        n_campaign += 1
        src = ip_for(n_campaign)
        for e, rule in zip(ev, rules):
            if produced >= rows:
                return
            detected = bool(rule)
            delta = 0 if detected or e["event_type"] != "weakness_found" else DAMAGE[e["severity"]]
            health = max(0, min(100, health + delta + 1))
            yield {
                "run_id": run_id, "seq": seq,
                "ts": dt.datetime.fromtimestamp(e["ms"] // 1000, dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                      + f".{e['ms'] % 1000:03d}",
                "event_type": e["event_type"], "agent_id": AGENT[persona], "agent_persona": persona,
                "target_component": e["component"], "severity": e["severity"], "description": e["description"],
                "payload": e["payload"], "http_status": e["http_status"], "evidence": "", "src_ip": src,
                "health_delta": delta, "tower_health": health, "detected": detected, "rule": rule,
                "detect_latency_ms": 0,  # filled with measured rule-query time by detect.py
                "confidence": round(rng.uniform(0.85, 0.99), 2) if detected else round(rng.uniform(0.1, 0.4), 2),
            }
            seq += 1
            produced += 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--rows", type=int, default=1000)
    ap.add_argument("--hours", type=float, default=24.0)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    for row in events(a.run_id, a.rows, a.hours, seed=a.seed):
        sys.stdout.write(json.dumps(row) + "\n")
