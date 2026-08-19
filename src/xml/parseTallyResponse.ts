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
 * Turns Tally's reply into a pass/fail result.
 *
 * Tally returns HTTP 200 even when it rejects a voucher — the outcome lives entirely inside this
 * XML. Success therefore requires CREATED > 0 or ALTERED > 0 *and* no LINEERROR; anything else is a
 * failure, including a response this function cannot make sense of.
 */
export function parseTallyResponse(xml: string): ConnectorResult {
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    return { ok: false, errorCode: 'TALLY_LINEERROR', error: 'Tally returned unparseable XML', rawXml: xml };
  }

  const data = doc?.ENVELOPE?.BODY?.DATA;
  if (!data) {
    return {
      ok: false,
      errorCode: 'TALLY_LINEERROR',
      error: 'Unexpected response from Tally — no ENVELOPE/BODY/DATA. Is that port really TallyPrime?',
      rawXml: xml,
    };
  }

  // Checked before IMPORTRESULT: an errored import may carry both, and the LINEERROR is the half
  // that actually tells the accountant what to fix.
  const lineError = firstString(data.LINEERROR);
  if (lineError) {
    return { ok: false, errorCode: 'TALLY_LINEERROR', error: lineError, rawXml: xml };
  }

  const result = data.IMPORTRESULT;
  if (!result) {
    return { ok: false, errorCode: 'TALLY_LINEERROR', error: 'Tally returned no IMPORTRESULT', rawXml: xml };
  }

  const createdCount = toInt(result.CREATED);
  const alteredCount = toInt(result.ALTERED);
  const errors = toInt(result.ERRORS);
  const exceptions = toInt(result.EXCEPTIONS);

  if (errors > 0 || exceptions > 0) {
    return {
      ok: false,
      errorCode: 'TALLY_LINEERROR',
      error: `Tally reported ${errors} error(s) and ${exceptions} exception(s)`,
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
