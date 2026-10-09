// inspect.js — read light metadata about the target folder.
// Dumb but looks smart: file count + grep for route patterns. Pure cosmetics.

import { readdirSync, statSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.venv', '__pycache__', 'vendor']);
const CODE_EXT = /\.(js|mjs|ts|tsx|jsx|py|go|rb|java|php|rs)$/;
const ROUTE_PATTERNS = [
  /app\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)/gi, // express
  /router\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)/gi,
  /@app\.route\(\s*['"`]([^'"`]+)/gi, // flask
  /@(?:router|app)\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)/gi, // fastapi
  /['"`](\/api\/[a-z0-9_\-/]+)['"`]/gi, // any /api/ literal
];

// Walk up to a cap so a huge repo doesn't stall the demo.
export function inspect(root, { maxFiles = 4000 } = {}) {
  let files = 0;
  const endpoints = new Set();
  const codeFiles = [];

  const walk = (dir, depth) => {
    if (files >= maxFiles || depth > 8) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (files >= maxFiles) break;
      if (ent.name.startsWith('.') && ent.name !== '.') {
        if (IGNORE.has(ent.name)) continue;
      }
      if (IGNORE.has(ent.name)) continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full, depth + 1);
      } else if (ent.isFile()) {
        files++;
        if (CODE_EXT.test(ent.name) && codeFiles.length < 400) codeFiles.push(full);
      }
    }
  };

  try {
    const s = statSync(root);
    if (!s.isDirectory()) throw new Error('not a directory');
  } catch {
    return { name: basename(root), files: 0, endpoints: [] };
  }

  walk(root, 0);

  // grep a sample of code files for routes
  for (const f of codeFiles.slice(0, 200)) {
    let txt;
    try {
      txt = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    if (txt.length > 200_000) txt = txt.slice(0, 200_000);
    for (const re of ROUTE_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(txt)) && endpoints.size < 40) {
        const route = m[2] || m[1];
        if (route && route.startsWith('/')) endpoints.add(route);
      }
    }
  }

  return {
    name: basename(root) || 'target',
    files,
    endpoints: [...endpoints].sort().slice(0, 12),
  };
}
