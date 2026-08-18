import crypto from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { AppConfig } from './config';

/**
 * Verifies the shared secret sent by the TMS backend. This sits behind Cloudflare Access, which
 * drops unauthenticated traffic at the edge; this check is the second layer, for anything that
 * reaches the process anyway.
 */
export function requireSecret(cfg: AppConfig) {
  const expected = Buffer.from(cfg.sharedSecret);

  return (req: Request, res: Response, next: NextFunction): void => {
    const provided = Buffer.from(String(req.header('x-connector-secret') ?? ''));
    // Lengths must match before timingSafeEqual, which throws when they differ.
    const valid = provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
    if (!valid) {
      res.status(401).json({ ok: false, errorCode: 'AUTH', error: 'Invalid or missing connector secret' });
      return;
    }
    next();
  };
}
