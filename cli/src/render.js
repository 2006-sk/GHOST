// render.js — pretty terminal lines (colors, columns). Keep it calm and aligned.

import pc from 'picocolors';

export const log = {
  step: (msg) => console.log(`  ${pc.cyan('▸')} ${msg}`),
  ok: (msg) => console.log(`  ${pc.cyan('▸')} ${msg} ${pc.green('✓')}`),
  info: (msg) => console.log(`  ${pc.dim('·')} ${pc.dim(msg)}`),
  err: (msg) => console.error(`  ${pc.red('✗')} ${pc.red(msg)}`),
  banner: (name, files) =>
    console.log(`  ${pc.bold(pc.magenta('▸ GHOST'))}  target: ${pc.bold(name)} ${pc.dim(`(${files} files)`)}`),
  raw: (msg) => console.log(msg),
};

const SEV_COLOR = {
  critical: (s) => pc.bgRed(pc.white(` ${s} `)),
  high: (s) => pc.red(s),
  medium: (s) => pc.yellow(s),
  low: (s) => pc.blue(s),
  info: (s) => pc.dim(s),
};

function pad(s, n) {
  s = String(s ?? '');
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function hhmmss(ts) {
  try {
    return new Date(ts).toISOString().slice(11, 19);
  } catch {
    return '--:--:--';
  }
}

// One compact line per event, merged with its detection verdict (by seq).
// event: enriched WS `event`; det: WS `detection` or null (not yet scored).
export function eventLine(event, det) {
  const time = pc.dim(hhmmss(event.ts));
  const agent = pad(event.agent_id, 8);
  const persona = pad(event.agent_persona, 11);
  const comp = pad(event.target_component || '-', 14);
  const kind = pad(verdictKind(event, det), 9);
  const sevRaw = (event.severity || 'info').toUpperCase();
  const sevFn = SEV_COLOR[(event.severity || 'info')] || ((s) => s);
  const sev = pad(sevRaw, 9);

  let tail;
  if (!det) {
    tail = pc.dim('· scoring…');
  } else if (det.detected) {
    tail = pc.green(`✓ ${det.latency_ms}ms`);
  } else {
    tail = pc.red('✗ MISSED');
  }
  return `     ${time}  ${pc.bold(agent)} ${persona} ${pc.cyan(comp)} ${kind} ${sevFn(sev)} ${tail}`;
}

function verdictKind(event, det) {
  if (event.event_type === 'weakness_found') return 'weakness';
  if (event.event_type === 'attack_result') return det?.detected ? 'blocked' : 'held';
  if (event.event_type === 'attack_started') return 'started';
  if (event.event_type === 'target_health') return 'health';
  return event.event_type;
}

function num(n) {
  return Number(n || 0).toLocaleString('en-US');
}

// Footer line from WS `stats`.
export function statsFooter(stats) {
  if (!stats) return '';
  const cov = pc.bold(pc.green(`${stats.coverage_pct ?? 0}%`));
  const mttd = pc.bold(`${stats.mttd_ms ?? 0}ms`);
  return (
    `  ${pc.dim('└')} coverage ${cov}   mttd ${mttd}   ` +
    `detected ${num(stats.detected)} / ${num(stats.total_events)}` +
    (stats.missed ? pc.dim(`   (missed ${num(stats.missed)})`) : '')
  );
}
