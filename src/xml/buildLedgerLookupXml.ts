import { InvoicePayload } from '../types';
import { escapeXml } from './escape';

/** Read-only list of every ledger name in a company, used to see what a voucher is missing. */
export function buildLedgerLookupXml(company: string): string {
  return (
    '<ENVELOPE>' +
    '<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>LedgerLookup</ID></HEADER>' +
    '<BODY><DESC><STATICVARIABLES>' +
    `<SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>` +
    '</STATICVARIABLES>' +
    '<TDL><TDLMESSAGE>' +
    '<COLLECTION NAME="LedgerLookup" ISINITIALIZE="Yes"><TYPE>Ledger</TYPE><NATIVEMETHOD>Name</NATIVEMETHOD></COLLECTION>' +
    '</TDLMESSAGE></TDL>' +
    '</DESC></BODY>' +
    '</ENVELOPE>'
  );
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Ledger names present in the company.
 *
 * Lower-cased by default because the callers that compare want that; `preserveCase` returns Tally's
 * own spelling, which is what has to be stored — Tally matches names verbatim, so a mapping saved
 * in the wrong case would point at a ledger that does not exist.
 */
export function ledgerNamesIn(xml: string, options: { preserveCase?: boolean } = {}): Set<string> {
  const names = [...xml.matchAll(/<LEDGER NAME="([^"]*)"/g)]
    .map((m) => unescapeXml(m[1]).trim())
    .map((n) => (options.preserveCase ? n : n.toLowerCase()));
  return new Set(names.filter(Boolean));
}

/** Every ledger a voucher refers to: party, sales lines, taxes, round-off. */
export function ledgersRequiredBy(payload: InvoicePayload): string[] {
  const wanted = [
    payload.party.ledgerName,
    ...payload.lines.map((l) => l.ledgerName),
    ...payload.taxes.map((t) => t.ledgerName),
    ...(payload.roundOffLedgerName ? [payload.roundOffLedgerName] : []),
  ];

  // De-duplicated case-insensitively, but the original spelling is kept: Tally matches names
  // verbatim, so a lower-cased name would create a second, differently-cased ledger.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of wanted) {
    const key = name?.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name.trim());
  }
  return out;
}

/**
 * The ledgers this voucher needs that the company does not have yet.
 *
 * Checking first rather than blindly re-sending every master keeps repeat pushes from asking Tally
 * to create ledgers it already holds, and means the create step usually sends nothing at all.
 */
export function missingLedgers(payload: InvoicePayload, existing: Set<string>): string[] {
  return ledgersRequiredBy(payload).filter((name) => !existing.has(name.toLowerCase()));
}
