import { Router } from 'express';
import net from 'node:net';
import { exec } from 'node:child_process';
import { AppConfig } from './config';
import { requireSecret } from './auth';
import { buildVoucherXml } from './xml/buildVoucherXml';
import { buildInvoiceXml } from './xml/buildInvoiceXml';
import { normalizeEduDate } from './xml/eduDate';
import { postToTally, postRawToTally } from './tallyClient';
import { buildVoucherLookupXml, voucherNumberPresent } from './xml/buildVoucherLookupXml';
import { buildLedgerLookupXml, ledgerNamesIn, missingLedgers } from './xml/buildLedgerLookupXml';
import { buildMastersImportXml } from './xml/buildMastersXml';
import { probeTally } from './tallyHealth';
import { InvoicePayload, VoucherPayload } from './types';

export function buildRouter(cfg: AppConfig): Router {
  const router = Router();
  const secured = requireSecret(cfg);

  // Left unauthenticated so monitoring and install.bat can call it without the shared secret.
  // Reports three states, not two. "not-responding" is the one that matters: Tally sitting on a
  // modal dialog keeps the port open, so a socket-level check would call that healthy.
  router.get('/health', async (_req, res) => {
    const tally = await probeTally(cfg);
    res.json({
      status: 'ok',
      tally,
      // The effective settings, so a misconfigured connector can be spotted from outside instead
      // of guessed at. No secrets here — only what is already visible in the XML it sends.
      config: {
        tallyPort: cfg.tallyPort,
        defaultCompany: cfg.defaultCompany,
        allowMasterCreate: cfg.allowMasterCreate,
        eduMode: cfg.eduMode,
      },
      ...(tally === 'not-responding'
        ? { hint: 'Tally is open but not answering — check for a dialog box on its screen.' }
        : {}),
    });
  });

  // Educational Tally rejects any voucher date other than the 1st, 2nd or last of the month. When
  // that flag is on we move the date and say so loudly — a silently altered date on a financial
  // document is exactly the kind of thing nobody should have to discover later.
  const resolveDate = (date: string, billNo: string): string => {
    if (!cfg.eduMode) return date;
    const adjusted = normalizeEduDate(date);
    if (adjusted !== date) {
      console.warn(`[EDU MODE] ${billNo}: voucher date ${date} -> ${adjusted} to satisfy educational Tally`);
    }
    return adjusted;
  };

  // A blank company falls back to the configured default — that is the per-branch mapping rule:
  // branches.tallyCompanyName wins, and blank means "use the connector's company".
  const renderXml = (body: VoucherPayload): string =>
    buildVoucherXml({
      ...body,
      company: body.company || cfg.defaultCompany,
      date: resolveDate(body.date, body.billNo),
    });

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

  // The full GST Sales Invoice, kept alongside /tally/voucher rather than replacing it: at the
  // client's office we need to try both and see which shape their Tally release actually accepts.
  const renderInvoiceXml = (body: InvoicePayload): string =>
    buildInvoiceXml(
      {
        ...body,
        company: body.company || cfg.defaultCompany,
        date: resolveDate(body.date, body.billNo),
      },
    );

  router.post('/tally/invoice/preview', secured, (req, res) => {
    try {
      res.json({ ok: true, xml: renderInvoiceXml(req.body as InvoicePayload) });
    } catch (err) {
      res.status(400).json({ ok: false, errorCode: 'BAD_PAYLOAD', error: (err as Error).message });
    }
  });

  router.post('/tally/invoice', secured, async (req, res) => {
    const body = req.body as InvoicePayload;
    let xml: string;
    try {
      xml = renderInvoiceXml(body);
    } catch (err) {
      res.status(400).json({ ok: false, errorCode: 'BAD_PAYLOAD', error: (err as Error).message });
      return;
    }

    // Ask Tally whether this bill is already there before importing. REMOTEID does not
    // deduplicate — the same voucher imported twice becomes two vouchers, verified against the
    // client's Tally — so without this a retry or a timeout writes double sales into their books.
    const company = body.company || cfg.defaultCompany;
    const date = resolveDate(body.date, body.billNo);
    const lookup = await postRawToTally(cfg, buildVoucherLookupXml(company, date));
    if (lookup.ok && voucherNumberPresent(lookup.body, body.billNo)) {
      res.json({
        ok: true,
        action: 'exists',
        voucherId: null,
        rawXml: lookup.body,
      });
      return;
    }
    // A failed lookup is not treated as "absent": importing on a guess is how duplicates happen.
    if (!lookup.ok) {
      res.json({
        ok: false,
        errorCode: 'TALLY_UNREACHABLE',
        error: `Could not check whether ${body.billNo} is already in Tally, so it was not imported — ${lookup.error}`,
        rawXml: null,
      });
      return;
    }

    // Create only what Tally is missing, then import. Checking first means a repeat push asks
    // Tally to create nothing, and a ledger that already exists is never touched.
    if (cfg.allowMasterCreate) {
      const ledgers = await postRawToTally(cfg, buildLedgerLookupXml(company));
      if (!ledgers.ok) {
        res.json({
          ok: false,
          errorCode: 'TALLY_UNREACHABLE',
          error: `Could not read Tally's ledgers, so nothing was imported — ${ledgers.error}`,
          rawXml: null,
        });
        return;
      }
      const missing = missingLedgers({ ...body, company, date }, ledgerNamesIn(ledgers.body));
      if (missing.length) {
        console.log(`[masters] creating ${missing.length} ledger(s) for ${body.billNo}: ${missing.join(', ')}`);
        const created = await postToTally(cfg, buildMastersImportXml({ ...body, company, date }, missing));
        if (!created.ok) {
          res.json({
            ok: false,
            errorCode: created.errorCode,
            error: `Could not create the missing ledgers (${missing.join(', ')}) — ${created.error}`,
            rawXml: created.rawXml,
          });
          return;
        }
      }
    }

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
