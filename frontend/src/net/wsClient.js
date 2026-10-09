// ── WebSocket client ────────────────────────────────────────────────────
// Connects to the Coordinator (mock or real), reconnects with backoff, and
// hands parsed messages to callbacks. Routes the four §4.5 kinds:
//   snapshot · event · detection · stats
// It assumes nothing about ordering: `tower_health` on each event is
// authoritative for the health bar, `detection` is matched back to its event
// by `seq`, and a bare (unwrapped) event still animates.

import { WS_URL } from "../config.js";

export function connectFeed({ onSnapshot, onEvent, onDetection, onStats, onStatus }) {
  let ws = null;
  let closedByUs = false;
  let backoff = 500;
  const maxBackoff = 6000;

  function open() {
    onStatus?.("connecting");
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      backoff = 500;
      onStatus?.("live");
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return; // ignore malformed frames rather than crash the demo
      }
      switch (msg.kind) {
        case "snapshot":  onSnapshot?.(msg); break;
        case "event":     onEvent?.(msg); break;
        case "detection": onDetection?.(msg); break;
        case "stats":     onStats?.(msg); break;
        default:
          // Be liberal: an unwrapped event still animates.
          if (msg.event_type) onEvent?.(msg);
      }
    };

    ws.onclose = () => {
      if (!closedByUs) {
        onStatus?.("down");
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      try { ws.close(); } catch {}
    };
  }

  function scheduleReconnect() {
    setTimeout(open, backoff);
    backoff = Math.min(maxBackoff, backoff * 1.7);
  }

  open();

  return {
    get url() { return WS_URL; },
    close() {
      closedByUs = true;
      try { ws?.close(); } catch {}
    },
  };
}
