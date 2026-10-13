import http from 'node:http';
import iconv from 'iconv-lite';
import { AppConfig } from './config';
import { ConnectorResult } from './types';
import { parseTallyResponse } from './xml/parseTallyResponse';
import { runExclusive, TallyBusyError } from './tallyQueue';

/** Tally's XML interface speaks windows-1252. Sending UTF-8 mangles any non-ASCII character. */
const TALLY_ENCODING = 'win1252';

/**
 * One fresh connection per request, closed afterwards (paired with `agent: false` on each call).
 *
 * Node 19+ keeps HTTP connections alive by default. Tally's listener closes an idle socket on its
 * own schedule without telling the client, so the next push could be written into a dead socket
 * and fail with ECONNRESET / "socket hang up" — only when pushes were a few seconds apart, which
 * is why it failed "sometimes". Connecting fresh costs well under a millisecond on localhost.
 */
const TALLY_HEADERS = {
  'Content-Type': 'text/xml;charset=windows-1252',
  Connection: 'close',
} as const;

/** Raw round-trip, for read-only queries whose reply is not an import result. */
export function postRawToTally(cfg: AppConfig, xml: string): Promise<{ ok: true; body: string } | { ok: false; error: string }> {
  // A rejected queue is an answer, not a crash: turn it into the same shape every caller handles.
  return runExclusive(() => new Promise<{ ok: true; body: string } | { ok: false; error: string }>((resolve) => {
    let settled = false;
    const done = (r: { ok: true; body: string } | { ok: false; error: string }) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const body = iconv.encode(xml, TALLY_ENCODING);
    const req = http.request(
      {
        host: cfg.tallyHost,
        port: cfg.tallyPort,
        method: 'POST',
        path: '/',
        timeout: cfg.tallyTimeoutMs,
        agent: false,
        headers: { ...TALLY_HEADERS, 'Content-Length': body.length },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done({ ok: true, body: iconv.decode(Buffer.concat(chunks), TALLY_ENCODING) }));
        res.on('error', (err) => done({ ok: false, error: `Tally closed the connection mid-reply — ${err.message}` }));
      },
    );
    req.on('timeout', () => {
      done({ ok: false, error: `Tally did not respond within ${cfg.tallyTimeoutMs}ms` });
      req.destroy();
    });
    req.on('error', (err) => done({ ok: false, error: err.message }));
    req.write(body);
    req.end();
  })).catch((err) =>
    err instanceof TallyBusyError ? { ok: false as const, error: err.message } : Promise.reject(err),
  );
}

export function postToTally(cfg: AppConfig, xml: string): Promise<ConnectorResult> {
  const body = iconv.encode(xml, TALLY_ENCODING);

  return runExclusive(() => new Promise<ConnectorResult>((resolve) => {
    let settled = false;
    const finish = (result: ConnectorResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const req = http.request(
      {
        host: cfg.tallyHost,
        port: cfg.tallyPort,
        method: 'POST',
        path: '/',
        timeout: cfg.tallyTimeoutMs,
        agent: false,
        headers: { ...TALLY_HEADERS, 'Content-Length': body.length },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => finish(parseTallyResponse(iconv.decode(Buffer.concat(chunks), TALLY_ENCODING))));
        // The request reached Tally and a reply had started, so — like a timeout — the voucher may
        // already be written. Without this listener the stream error had no handler and crashed
        // the whole connector.
        res.on('error', (err) =>
          finish({
            ok: false,
            errorCode: 'TALLY_TIMEOUT',
            error:
              `Tally closed the connection mid-reply — ${err.message}. ` +
              'The voucher may still have been written, so check Tally before sending it again.',
            rawXml: null,
          }),
        );
      },
    );

    req.on('timeout', () => {
      finish({
        ok: false,
        errorCode: 'TALLY_TIMEOUT',
        // Says to check rather than to retry. Tally accepted the request and went quiet, so it may
        // have written the voucher before falling silent, and REMOTEID does not deduplicate.
        error:
          `Tally did not respond within ${cfg.tallyTimeoutMs}ms — it may be waiting on a dialog box. ` +
          'The voucher may still have been written, so check Tally before sending it again.',
        rawXml: null,
      });
      // destroy() fires an 'error' afterwards; the settled guard above keeps it from overwriting this.
      req.destroy();
    });

    req.on('error', (err) => {
      finish({
        ok: false,
        errorCode: 'TALLY_UNREACHABLE',
        error:
          `Cannot reach Tally at ${cfg.tallyHost}:${cfg.tallyPort} — ${err.message}. ` +
          'Is TallyPrime open with a company loaded?',
        rawXml: null,
      });
    });

    req.write(body);
    req.end();
  })).catch((err) => {
    if (err instanceof TallyBusyError) {
      // Reported as unreachable on purpose: nothing was sent, so the backend may safely try later.
      return {
        ok: false as const,
        errorCode: 'TALLY_UNREACHABLE' as const,
        error: err.message,
        rawXml: null,
      };
    }
    throw err;
  });
}
