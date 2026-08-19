import 'dotenv/config';
import express from 'express';
import { loadConfig } from './config';
import { buildRouter } from './routes';
import { log, pruneOldLogs, setLogSecrets } from './logger';

const cfg = loadConfig(process.env);
// Registered before anything else can log, so the secret cannot reach a file even on a crash.
setLogSecrets([cfg.sharedSecret]);

const pruned = pruneOldLogs();

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(buildRouter(cfg));

const server = app.listen(cfg.port, cfg.host, () => {
  if (pruned.length) log.info('pruned old log files', { count: pruned.length });
  log.info('tally-connector started', {
    listening: `http://${cfg.host}:${cfg.port}`,
    tally: `http://${cfg.tallyHost}:${cfg.tallyPort}`,
    defaultCompany: cfg.defaultCompany,
    allowMasterCreate: cfg.allowMasterCreate,
    eduMode: cfg.eduMode,
  });
  if (cfg.eduMode) {
    // Impossible to leave on by accident without seeing this on every start.
    log.warn('TALLY_EDU_MODE IS ON — voucher dates will be rewritten. Never use against a licensed Tally.');
  }
});

// Without this, a failed bind kills the process with no message at all — and under a Windows
// service that reads as "installed fine, health check fails, no idea why".
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRNOTAVAIL') {
    log.error(
      `FATAL: cannot bind ${cfg.host}:${cfg.port} — ${cfg.host} is not an address on this machine.\n` +
        `       Set HOST in .env to this PC's own address, or remove it to use 127.0.0.1.`,
    );
  } else if (err.code === 'EADDRINUSE') {
    log.error(
      `FATAL: port ${cfg.port} is already in use — another connector is probably still running.\n` +
        `       Stop it first, or change PORT in .env.`,
    );
  } else if (err.code === 'EACCES') {
    log.error(`FATAL: not permitted to bind ${cfg.host}:${cfg.port}.`);
  } else {
    log.error(`FATAL: could not start on ${cfg.host}:${cfg.port} — ${err.message}`);
  }
  process.exit(1);
});
