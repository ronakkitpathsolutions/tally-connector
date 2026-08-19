import { InvoicePayload } from '../types';
import { escapeXml } from './escape';

/**
 * Ledger-creation messages to send ahead of a voucher, so an import into a fresh company does not
 * fail on ledgers that do not exist yet.
 *
 * Gated by ALLOW_MASTER_CREATE and off by default. Against a real company this is dangerous: a
 * mapping typo silently becomes a new ledger rather than a loud failure, and the client is left
 * with near-duplicate accounts to clean up by hand.
 */

/** Tally's own duty-head names, which differ from the CGST/SGST/IGST shorthand. */
const GST_DUTY_HEAD: Record<string, string> = {
  CGST: 'Central Tax',
  SGST: 'State Tax',
  IGST: 'Integrated Tax',
};

function ledgerXml(name: string, parent: string, extras = ''): string {
  const escaped = escapeXml(name);
  return (
    `<LEDGER NAME="${escaped}" ACTION="Create">` +
    `<NAME>${escaped}</NAME>` +
    `<PARENT>${escapeXml(parent)}</PARENT>` +
    extras +
    '</LEDGER>'
  );
}

export function buildMastersXml(payload: InvoicePayload, only?: string[]): string {
  // `only` narrows this to the ledgers Tally is actually missing. Without it every push would ask
  // Tally to re-create ledgers it already holds.
  const wanted = only ? new Set(only.map((n) => n.trim().toLowerCase())) : null;
  const needed = (name: string) => !wanted || wanted.has(name.trim().toLowerCase());

  const messages: string[] = [];

  // Bill-wise tracking on the party keeps the invoice reference usable for receipts later.
  const partyExtras =
    '<ISBILLWISEON>Yes</ISBILLWISEON>' +
    (payload.party.gstin ? `<PARTYGSTIN>${escapeXml(payload.party.gstin)}</PARTYGSTIN>` : '') +
    `<GSTREGISTRATIONTYPE>${escapeXml(payload.party.registrationType ?? 'Regular')}</GSTREGISTRATIONTYPE>` +
    (payload.party.stateName ? `<LEDSTATENAME>${escapeXml(payload.party.stateName)}</LEDSTATENAME>` : '') +
    '<COUNTRYNAME>India</COUNTRYNAME>';
  if (needed(payload.party.ledgerName)) messages.push(ledgerXml(payload.party.ledgerName, 'Sundry Debtors', partyExtras));

  // A bill can repeat the same sales ledger across charge types; create it once.
  const seen = new Set<string>([payload.party.ledgerName]);

  for (const line of payload.lines) {
    if (seen.has(line.ledgerName)) continue;
    seen.add(line.ledgerName);
    if (!needed(line.ledgerName)) continue;
    const isRoundOff = line.ledgerName === payload.roundOffLedgerName;
    messages.push(ledgerXml(line.ledgerName, isRoundOff ? 'Indirect Expenses' : 'Sales Accounts'));
  }

  for (const tax of payload.taxes) {
    if (seen.has(tax.ledgerName)) continue;
    seen.add(tax.ledgerName);
    if (!needed(tax.ledgerName)) continue;
    messages.push(
      ledgerXml(
        tax.ledgerName,
        'Duties & Taxes',
        '<TAXTYPE>GST</TAXTYPE>' +
          `<GSTDUTYHEAD>${escapeXml(GST_DUTY_HEAD[tax.dutyHead] ?? tax.dutyHead)}</GSTDUTYHEAD>` +
          '<AFFECTSSTOCK>No</AFFECTSSTOCK>',
      ),
    );
  }

  if (payload.roundOffLedgerName && !seen.has(payload.roundOffLedgerName) && needed(payload.roundOffLedgerName)) {
    seen.add(payload.roundOffLedgerName);
    messages.push(ledgerXml(payload.roundOffLedgerName, 'Indirect Expenses'));
  }

  return messages.map((m) => `<TALLYMESSAGE xmlns:UDF="TallyUDF">${m}</TALLYMESSAGE>`).join('');
}

/**
 * The same ledger messages wrapped in a complete import envelope, for sending on their own ahead of
 * the voucher. buildMastersXml alone returns only TALLYMESSAGE blocks, which Tally cannot accept as
 * a request.
 */
export function buildMastersImportXml(payload: InvoicePayload, only?: string[]): string {
  return (
    '<ENVELOPE>' +
    '<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>' +
    '<BODY><IMPORTDATA>' +
    '<REQUESTDESC>' +
    '<REPORTNAME>All Masters</REPORTNAME>' +
    `<STATICVARIABLES><SVCURRENTCOMPANY>${escapeXml(payload.company)}</SVCURRENTCOMPANY></STATICVARIABLES>` +
    '</REQUESTDESC>' +
    `<REQUESTDATA>${buildMastersXml(payload, only)}</REQUESTDATA>` +
    '</IMPORTDATA></BODY>' +
    '</ENVELOPE>'
  );
}
