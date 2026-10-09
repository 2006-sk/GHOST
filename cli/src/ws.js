// ws.js — minimal WS client. Subscribes to the coordinator stream, merges
// `event` + `detection` by seq, and invokes callbacks for lines + stats.

import { WebSocket } from 'ws';

// Connect and stream. Returns a handle with .close().
// opts: { runId, onEvent(enrichedEvent, detection|null), onStats(stats), onOpen, onClose, graceMs }
// Each event is held for a short grace window so its `detection` (which arrives
// just after, matched by seq) collapses into ONE printed line. If the verdict
// lags past the window (real mode), the line prints as "scoring…" and is not
// reprinted — status/stats reflect the final verdict.
export function connectStream(wsUrl, opts = {}) {
  const { runId, onEvent, onStats, onOpen, onClose, graceMs = 80 } = opts;

  // events awaiting their detection, keyed by seq: { event, det, timer, emitted }
  const pending = new Map();

  let ws;
  let closedByUs = false;
  let backoff = 500;

  const matchesRun = (m) => !runId || !m.run_id || m.run_id === runId;

  const emit = (seq) => {
    const p = pending.get(seq);
    if (!p || p.emitted) return;
    p.emitted = true;
    if (p.timer) clearTimeout(p.timer);
    onEvent?.(p.event, p.det || null);
    pending.delete(seq);
  };

  const handle = (m) => {
    if (!matchesRun(m)) return;
    switch (m.kind) {
      case 'snapshot':
        if (Array.isArray(m.events)) {
          // historical events: no detection coming — print immediately, in order
          for (const ev of [...m.events].sort((a, b) => (a.seq || 0) - (b.seq || 0))) {
            if (!ev.corrected) onEvent?.(ev, null);
          }
        }
        if (m.stats) onStats?.(m.stats);
        break;
      case 'event': {
        if (m.corrected) return; // health-correction echo; ignore in the log
        const existing = pending.get(m.seq);
        if (existing) {
          existing.event = m;
          if (existing.det) emit(m.seq);
          return;
        }
        const p = { event: m, det: null, emitted: false, timer: null };
        p.timer = setTimeout(() => emit(m.seq), graceMs);
        pending.set(m.seq, p);
        break;
      }
      case 'detection': {
        const p = pending.get(m.seq);
        if (p) {
          p.det = m;
          emit(m.seq); // event already here → print merged now
        } else {
          // detection arrived first (rare) — hold briefly for its event
          const np = { event: null, det: m, emitted: false, timer: null };
          np.timer = setTimeout(() => pending.delete(m.seq), graceMs);
          pending.set(m.seq, np);
        }
        break;
      }
      case 'stats':
        onStats?.(m);
        break;
    }
  };

  const open = () => {
    ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      backoff = 500;
      onOpen?.();
    });
    ws.on('message', (buf) => {
      let m;
      try {
        m = JSON.parse(buf.toString());
      } catch {
        return;
      }
      handle(m);
    });
    ws.on('close', () => {
      if (closedByUs) return;
      onClose?.();
      setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 5000);
    });
    ws.on('error', () => {
      /* close handler will retry */
    });
  };

  open();

  return {
    close() {
      closedByUs = true;
      try {
        ws?.close();
      } catch {
        /* noop */
      }
    },
  };
}
