// watch.js — attach to a run's WS stream and print compact lines + stats footer.
// Shared by `ghost run` (after launch) and `ghost watch <run_id>`.

import { connectStream } from '../ws.js';
import { eventLine, statsFooter, log } from '../render.js';
import pc from 'picocolors';

// Stream until ctrl-c. Resolves when the user detaches.
export function streamRun({ wsUrl, runId }) {
  return new Promise((resolve) => {
    let lastStats = null;
    let footerShown = false;

    const refreshFooter = () => {
      if (!lastStats) return;
      // repaint footer in place: clear line, print, so it tracks live
      process.stdout.write('\r' + statsFooter(lastStats) + '   \n');
      footerShown = true;
    };

    const stream = connectStream(wsUrl, {
      runId,
      onOpen: () => log.ok('siege live — watching. ctrl-c to detach'),
      onClose: () => log.info('stream dropped — reconnecting…'),
      onEvent: (event, det) => {
        console.log(eventLine(event, det));
      },
      onStats: (stats) => {
        lastStats = stats;
      },
    });

    // footer tick every 1s
    const footerTimer = setInterval(refreshFooter, 1000);

    const shutdown = () => {
      clearInterval(footerTimer);
      stream.close();
      if (footerShown) process.stdout.write('\n');
      log.info('detached.');
      resolve();
    };

    process.on('SIGINT', shutdown);
  });
}
