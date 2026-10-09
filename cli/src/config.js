// config.js — resolve COORDINATOR_URL / DASHBOARD_URL from flags then env then default.

export const DEFAULTS = {
  coordinator: process.env.COORDINATOR_URL || 'http://localhost:8080',
  dashboard: process.env.DASHBOARD_URL || 'http://localhost:5173',
};

// Minimal zero-dep arg parser. Returns { _: [positional], flags: {...} }.
// Supports: --flag, --flag value, --no-flag, -x.
export function parseArgs(argv) {
  const _ = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key.startsWith('no-')) {
        flags[camel(key.slice(3))] = false;
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        flags[camel(key)] = argv[++i];
      } else {
        flags[camel(key)] = true;
      }
    } else if (a.startsWith('-') && a.length === 2) {
      flags[a.slice(1)] = true;
    } else {
      _.push(a);
    }
  }
  return { _, flags };
}

function camel(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// Resolve effective config for a command from its flags.
export function resolveConfig(flags) {
  const coordinator = (flags.coordinator || DEFAULTS.coordinator).replace(/\/$/, '');
  const dashboard = (flags.dashboard || DEFAULTS.dashboard).replace(/\/$/, '');
  // coordinator http -> ws url
  const wsUrl = coordinator.replace(/^http/, 'ws') + '/ws';
  // mode: --mock / --real / --demo / --mode <x> ; else coordinator decides
  let mode;
  if (flags.mock) mode = 'mock';
  if (flags.real) mode = 'real';
  if (flags.demo) mode = 'demo';
  if (flags.mode) mode = String(flags.mode).toLowerCase();
  const target = flags.target || ''; // target URL for demo (bank), optional
  return { coordinator, dashboard, wsUrl, mode, target };
}
