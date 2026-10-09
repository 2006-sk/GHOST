#!/usr/bin/env node
// ghost — terminal launcher for a GHOST siege.
//   ghost run [path]      launch a siege against the folder + open the dashboard
//   ghost watch <run_id>  attach to a running/finished siege
//   ghost status [run_id] one-shot coverage/health, then exit

import pc from 'picocolors';
import { parseArgs, resolveConfig, DEFAULTS } from '../src/config.js';
import { cmdRun } from '../src/commands/run.js';
import { cmdStatus } from '../src/commands/status.js';
import { streamRun } from '../src/commands/watch.js';
import { log } from '../src/render.js';

const argv = process.argv.slice(2);
const command = argv[0];
const parsed = parseArgs(argv.slice(1));

function usage() {
  console.log(`
${pc.bold(pc.magenta('ghost'))} — terminal launcher for a GHOST siege

${pc.bold('Usage')}
  ghost run [path]            launch a siege against a folder (default: cwd), open dashboard
  ghost demo [path]           launch the DEMO siege (cached, paced ~30s) + open dashboard
  ghost watch <run_id>        attach to a running/finished siege, stream lines
  ghost status [run_id]       one-shot coverage/health/events, then exit

${pc.bold('Flags')} (run / demo)
  --demo                      demo mode: cached, deterministic, paced siege
  --duration <sec>            demo length in seconds (default 30)
  --mock / --real             override mode (default: coordinator's env)
  --coordinator <url>         default ${DEFAULTS.coordinator}  (env COORDINATOR_URL)
  --dashboard  <url>          default ${DEFAULTS.dashboard}   (env DASHBOARD_URL)
  --no-open                   don't launch the browser
  --run-id <id>               name the run (else coordinator generates)
`);
}

async function main() {
  switch (command) {
    case 'run':
      return cmdRun(parsed);
    case 'demo':
      parsed.flags.demo = true;     // ghost demo == ghost run --demo
      return cmdRun(parsed);
    case 'watch': {
      const runId = parsed._[0];
      if (!runId) {
        log.err('ghost watch needs a <run_id>');
        process.exitCode = 1;
        return;
      }
      const cfg = resolveConfig(parsed.flags);
      log.info(`attaching to ${runId} @ ${cfg.wsUrl}`);
      return streamRun({ wsUrl: cfg.wsUrl, runId });
    }
    case 'status':
      if (parsed._[0]) parsed.flags.runId = parsed._[0];
      return cmdStatus(parsed);
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      return usage();
    default:
      log.err(`unknown command: ${command}`);
      usage();
      process.exitCode = 1;
  }
}

main().catch((err) => {
  log.err(err.message || String(err));
  process.exitCode = 1;
});
