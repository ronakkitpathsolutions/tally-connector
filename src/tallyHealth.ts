import http from 'node:http';
import { AppConfig } from './config';

export type TallyHealth = 'connected' | 'not-responding' | 'unreachable';

/** Short on purpose: /health is polled, and a hung Tally should be reported quickly, not waited on. */
const PROBE_TIMEOUT_MS = 5000;

/**
 * Asks Tally whether it is actually able to answer.
 *
 * A plain TCP connect is not enough. When TallyPrime is sitting on a modal dialog it still accepts
 * connections and then says nothing — so a socket-level check reports "connected" while every real
 * request hangs. That false positive is worse than no check at all: install.bat and any monitoring
 * would report success on a Tally that cannot process a single voucher.
 *
 * A bare GET is safe to repeat — Tally answers it with
 * `<RESPONSE>TallyPrime Server is Running</RESPONSE>` and it touches no company data.
 */
export function probeTally(cfg: AppConfig, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<TallyHealth> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: TallyHealth) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const req = http.request(
      { host: cfg.tallyHost, port: cfg.tallyPort, method: 'GET', path: '/', timeout: timeoutMs },
      (res) => {
        res.resume(); // drain, or the socket stays open
        done('connected');
      },
    );

    req.on('timeout', () => {
      // Connected but silent — the dialog case.
      done('not-responding');
      req.destroy();
    });

    req.on('error', () => done('unreachable'));

    req.end();
  });
}
