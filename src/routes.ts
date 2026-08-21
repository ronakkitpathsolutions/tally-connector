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
import { buildMastersImportXml } from './xml/buildMastersXml';
import { buildLedgerLookupXml, ledgerNamesIn, ledgersRequiredBy, ledgersWithGroups } from './xml/buildLedgerLookupXml';
import { matchToPayloadLedger, parseMissingLedger } from './xml/parseMissingLedger';
import { probeTally } from './tallyHealth';
import { queueDepth } from './tallyQueue';
import { log } from './logger';
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
      // How many Tally calls are queued behind this one. Anything consistently above 1 means
      // pushes are arriving faster than Tally can answer.
      queued: queueDepth(),
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
    const startedAt = Date.now();
    const took = () => `${Date.now() - startedAt}ms`;
    let xml: string;
    try {
      xml = renderInvoiceXml(body);
    } catch (err) {
      log.warn('rejected before Tally', { billNo: body.billNo, reason: (err as Error).message });
      res.status(400).json({ ok: false, errorCode: 'BAD_PAYLOAD', error: (err as Error).message });
      return;
    }

    log.info('push received', { billNo: body.billNo, company: body.company || cfg.defaultCompany, queued: queueDepth() });

    // Ask Tally whether this bill is already there before importing. REMOTEID does not
    // deduplicate — the same voucher imported twice becomes two vouchers, verified against the
    // client's Tally — so without this a retry or a timeout writes double sales into their books.
    const company = body.company || cfg.defaultCompany;
    const date = resolveDate(body.date, body.billNo);
    // Skipped unless TALLY_DUPLICATE_CHECK is on: against this client's Tally the voucher
    // collection never returns, and every push died here at the 30s timeout without importing.
    const lookup = cfg.duplicateCheck
      ? await postRawToTally(cfg, buildVoucherLookupXml(company, date))
      : { ok: true as const, body: '' };

    if (cfg.duplicateCheck && lookup.ok && voucherNumberPresent(lookup.body, body.billNo)) {
      log.info('already in Tally, skipped', { billNo: body.billNo, took: took() });
      res.json({
        ok: true,
        action: 'exists',
        voucherId: null,
        rawXml: lookup.body,
      });
      return;
    }
    // A failed lookup is not treated as "absent": importing on a guess is how duplicates happen.
    if (cfg.duplicateCheck && !lookup.ok) {
      log.error('duplicate check failed, not imported', { billNo: body.billNo, reason: lookup.error, took: took() });
      res.json({
        ok: false,
        errorCode: 'TALLY_UNREACHABLE',
        error: `Could not check whether ${body.billNo} is already in Tally, so it was not imported — ${lookup.error}`,
        rawXml: null,
      });
      return;
    }

    // Import first, and let Tally name what is missing, rather than downloading the company's
    // ledger list to find out. That list is 5,218 entries in the client's real company; fetching it
    // per invoice made a 50-invoice batch take minutes and blocked a Tally four other people use.
    // In the normal case — every ledger already there — this costs one request and no lookup.
    //
    // Tally reports one missing ledger at a time, so a voucher short of several needs a round each.
    // The cap is the number of ledgers this voucher could possibly need, so the loop cannot spin.
    const payloadLedgers = ledgersRequiredBy({ ...body, company, date });
    let result = await postToTally(cfg, xml);

    for (let round = 0; cfg.allowMasterCreate && !result.ok && round < payloadLedgers.length; round += 1) {
      if (result.errorCode !== 'TALLY_LINEERROR') break;

      const named = parseMissingLedger(result.error);
      const toCreate = named ? matchToPayloadLedger(named, payloadLedgers) : null;
      // Only ever create a name this voucher itself asked for. Any other "does not exist" text
      // from Tally is left alone rather than turned into a ledger in the client's books.
      if (!toCreate) break;

      log.info('creating missing ledger', { billNo: body.billNo, ledger: toCreate, round: round + 1 });
      const created = await postToTally(cfg, buildMastersImportXml({ ...body, company, date }, [toCreate]));
      if (!created.ok) {
        log.error('ledger creation failed', { billNo: body.billNo, ledger: toCreate, reason: created.error });
        break;
      }
      result = await postToTally(cfg, xml);
    }

    if (result.ok) {
      log.info('imported', { billNo: body.billNo, action: result.action, voucherId: result.voucherId, took: took() });
    } else {
      // Tally's own words, kept verbatim — a paraphrase here is a paraphrase in every bug report.
      log.error('Tally rejected the voucher', {
        billNo: body.billNo,
        errorCode: result.errorCode,
        reason: result.error,
        took: took(),
      });
    }
    res.json(result);
  });

  /**
   * Every ledger name in the company, for the portal to map its masters against.
   *
   * Read-only and deliberately not part of a push: the client's real company holds 5,218 ledgers,
   * which is fine to fetch once when someone asks and ruinous to fetch per invoice.
   */
  router.get('/tally/ledgers', secured, async (req, res) => {
    const company = String(req.query.company ?? '') || cfg.defaultCompany;
    // Reads from mastersPort, which may be the live company; imports always use tallyPort.
    const reply = await postRawToTally({ ...cfg, tallyPort: cfg.mastersPort }, buildLedgerLookupXml(company));
    if (!reply.ok) {
      log.error('ledger list failed', { company, reason: reply.error });
      res.json({ ok: false, errorCode: 'TALLY_UNREACHABLE', error: reply.error });
      return;
    }
    // Names and groups, because a customer must only ever be mapped to a Sundry Debtor.
    const ledgers = ledgersWithGroups(reply.body);
    log.info('ledger list served', { company, port: cfg.mastersPort, count: ledgers.length });
    res.json({ ok: true, company, count: ledgers.length, ledgers });
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
