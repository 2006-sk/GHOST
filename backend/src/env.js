// env.js — load backend/.env into process.env before any other module reads it.
// Imported first by server.js. Safe no-op if there's no .env or an older Node.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url)); // backend/src
const candidates = [join(here, '..', '.env'), join(process.cwd(), '.env')];

for (const p of candidates) {
  if (existsSync(p)) {
    try {
      process.loadEnvFile(p);
      break;
    } catch {
      // Node < 20.12 or unreadable file — fall back to the real environment.
    }
  }
}
