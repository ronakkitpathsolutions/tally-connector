import { XMLParser } from 'fast-xml-parser';
import { ConnectorResult } from '../types';

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });

function firstString(node: unknown): string | null {
  if (node === null || node === undefined) return null;
  if (Array.isArray(node)) return node.length ? String(node[0]) : null;
  const value = String(node);
  return value.length ? value : null;
}

function toInt(node: unknown): number {
  const n = Number(firstString(node));
  return Number.isFinite(n) ? n : 0;
}

/**
 * The block carrying CREATED/ALTERED/LINEERROR, whichever shape Tally used.
 *
 * TallyPrime answers an import with a bare `<RESPONSE>` root. The documented
 * ENVELOPE/BODY/DATA/IMPORTRESULT shape appears elsewhere in its API, so both are accepted —
 * assuming only the documented one made every successful import read as a failure, which in
 * production means the portal says "failed" for a voucher Tally has already written, and the
 * accountant retries into a duplicate.
 */
function resultNode(doc: any): any {
  const data = doc?.ENVELOPE?.BODY?.DATA;
  if (data) return data.IMPORTRESULT ?? data;
  return doc?.RESPONSE ?? null;
}

export function parseTallyResponse(xml: string): ConnectorResult {
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    return { ok: false, errorCode: 'TALLY_LINEERROR', error: 'Tally returned unparseable XML', rawXml: xml };
  }

  const result = resultNode(doc);
  if (!result) {
    return {
      ok: false,
      errorCode: 'TALLY_LINEERROR',
      error: 'Unexpected response from Tally — no import result. Is that port really TallyPrime?',
      rawXml: xml,
    };
  }

  // Checked first: an errored import can carry both, and the LINEERROR is the half that actually
  // tells the accountant what to fix.
  const lineError = firstString(result.LINEERROR);
  if (lineError) {
    return { ok: false, errorCode: 'TALLY_LINEERROR', error: lineError, rawXml: xml };
  }

  const createdCount = toInt(result.CREATED);
  const alteredCount = toInt(result.ALTERED);
  const errors = toInt(result.ERRORS);
  const exceptions = toInt(result.EXCEPTIONS);

  if (errors > 0 || exceptions > 0) {
    // A rejected voucher shows up here as EXCEPTIONS 1 with no LINEERROR and an HTTP 200 — Tally
    // gives no reason at all, so say plainly that it was rejected rather than inventing one.
    return {
      ok: false,
      errorCode: exceptions > 0 && errors === 0 ? 'TALLY_NO_CHANGE' : 'TALLY_LINEERROR',
      error:
        exceptions > 0 && errors === 0
          ? 'Tally rejected the voucher (1 exception, no reason given). Check the voucher type and ledger names.'
          : `Tally reported ${errors} error(s) and ${exceptions} exception(s)`,
      rawXml: xml,
    };
  }

  if (createdCount === 0 && alteredCount === 0) {
    return {
      ok: false,
      errorCode: 'TALLY_NO_CHANGE',
      error: 'Tally accepted the request but created and altered nothing (voucher ignored)',
      rawXml: xml,
    };
  }

  return {
    ok: true,
    action: createdCount > 0 ? 'created' : 'altered',
    voucherId: firstString(result.LASTVCHID),
    rawXml: xml,
  };
}
