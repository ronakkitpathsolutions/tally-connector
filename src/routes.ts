import { Router } from 'express';
import net from 'node:net';
import { exec } from 'node:child_process';
import { AppConfig } from './config';
import { requireSecret } from './auth';
import { buildVoucherXml } from './xml/buildVoucherXml';
import { postToTally } from './tallyClient';
import { VoucherPayload } from './types';

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
  const secured = requireSecret(cfg);

  // Left unauthenticated so monitoring and install.bat can call it without the shared secret.
  router.get('/health', async (_req, res) => {
    const tally = await tallyReachable(cfg);
    res.json({ status: 'ok', tally: tally ? 'connected' : 'unreachable' });
  });

  // A blank company falls back to the configured default — that is the per-branch mapping rule:
  // branches.tallyCompanyName wins, and blank means "use the connector's company".
  const renderXml = (body: VoucherPayload): string =>
    buildVoucherXml({ ...body, company: body.company || cfg.defaultCompany });

  router.post('/tally/preview', secured, (req, res) => {
    try {
      res.json({ ok: true, xml: renderXml(req.body as VoucherPayload) });
    } catch (err) {
      res.status(400).json({ ok: false, errorCode: 'BAD_PAYLOAD', error: (err as Error).message });
    }
  });

  router.post('/tally/voucher', secured, async (req, res) => {
    let xml: string;
    try {
      xml = renderXml(req.body as VoucherPayload);
    } catch (err) {
      // 400: the payload is wrong and retrying it unchanged cannot help.
      res.status(400).json({ ok: false, errorCode: 'BAD_PAYLOAD', error: (err as Error).message });
      return;
    }
    // 200 with ok:false for anything Tally-side — that is a result, not a transport failure.
    res.json(await postToTally(cfg, xml));
  });

  router.post('/admin/update', secured, (_req, res) => {
    // Lets an XML fix ship without physically visiting the client's PC. NSSM restarts the service
    // after it exits, so the process ends itself once the build succeeds.
    exec('git pull && npm ci && npm run build', { cwd: process.cwd() }, (err, stdout, stderr) => {
      if (err) {
        res.status(500).json({ ok: false, errorCode: 'UPDATE_FAILED', error: stderr || err.message });
        return;
      }
      res.json({ ok: true, output: stdout });
      setTimeout(() => process.exit(0), 500);
    });
  });

  return router;
}
