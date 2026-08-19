import 'dotenv/config';
import express from 'express';
import { loadConfig } from './config';
import { buildRouter } from './routes';

const cfg = loadConfig(process.env);

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(buildRouter(cfg));

const server = app.listen(cfg.port, cfg.host, () => {
  console.log(`tally-connector listening on http://${cfg.host}:${cfg.port}`);
  // cfg.tallyHost, not cfg.host: the bind address and the Tally target are different things,
  // and a log that conflates them sends you hunting in the wrong place.
  console.log(`tally target: http://${cfg.tallyHost}:${cfg.tallyPort}`);
  console.log(`default company: ${cfg.defaultCompany}`);
  if (cfg.eduMode) {
    // Impossible to leave on by accident without seeing this on every start.
    console.warn('*** TALLY_EDU_MODE IS ON — voucher dates will be rewritten. NEVER use against a licensed Tally. ***');
  }
});

// Without this, a failed bind kills the process with no message at all — and under a Windows
// service that reads as "installed fine, health check fails, no idea why".
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRNOTAVAIL') {
    console.error(
      `FATAL: cannot bind ${cfg.host}:${cfg.port} — ${cfg.host} is not an address on this machine.\n` +
        `       Set HOST in .env to this PC's own address, or remove it to use 127.0.0.1.`,
    );
  } else if (err.code === 'EADDRINUSE') {
    console.error(
      `FATAL: port ${cfg.port} is already in use — another connector is probably still running.\n` +
        `       Stop it first, or change PORT in .env.`,
    );
  } else if (err.code === 'EACCES') {
    console.error(`FATAL: not permitted to bind ${cfg.host}:${cfg.port}.`);
  } else {
    console.error(`FATAL: could not start on ${cfg.host}:${cfg.port} — ${err.message}`);
  }
  process.exit(1);
});
