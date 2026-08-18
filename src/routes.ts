import { Router } from 'express';
import net from 'node:net';
import { AppConfig } from './config';

/**
 * Probes whether anything is listening on Tally's port. A plain TCP connect rather than an XML
 * round-trip: this runs on every /health call, and the question here is only "is Tally up".
 */
export function tallyReachable(cfg: AppConfig): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(3000);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(cfg.tallyPort, cfg.tallyHost);
  });
}

export function buildRouter(cfg: AppConfig): Router {
  const router = Router();

  // Left unauthenticated so monitoring and install.bat can call it without the shared secret.
  router.get('/health', async (_req, res) => {
    const tally = await tallyReachable(cfg);
    res.json({ status: 'ok', tally: tally ? 'connected' : 'unreachable' });
  });

  return router;
}
