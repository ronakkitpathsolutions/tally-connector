import { VoucherPayload, LedgerEntry } from '../types';
import { escapeXml, formatAmount } from './escape';

/**
 * Half a paisa. Rounded GST halves routinely leave sub-paisa dust, so a stricter check would reject
 * valid vouchers; a looser one would let a real imbalance through and Tally would reject it with a
 * far less helpful message.
 */
const BALANCE_TOLERANCE = 0.005;

// "Invoice Voucher View" is the inventory/stock-item view and TallyPrime throws it out as an
// exception for a services bill — verified against the client's Tally, where it silently
// returned EXCEPTIONS 1 with no LINEERROR. Freight and agency charges are accounting lines,
// so this is the correct view as well as the one that imports.
const VOUCHER_VIEW = 'Accounting Voucher View';

/** Below this an entry is treated as zero and dropped rather than sent as "0.00". */
const ZERO_THRESHOLD = 0.005;

function ledgerEntryXml(entry: LedgerEntry): string {
  // Tally's convention, not arithmetic intuition: a debited ledger carries a negative AMOUNT and
  // ISDEEMEDPOSITIVE Yes. On a Sales voucher that is the party; sales and tax ledgers are credited.
  const deemedPositive = entry.amount < 0 ? 'Yes' : 'No';
  return (
    '<ALLLEDGERENTRIES.LIST>' +
    `<LEDGERNAME>${escapeXml(entry.ledgerName)}</LEDGERNAME>` +
    `<ISDEEMEDPOSITIVE>${deemedPositive}</ISDEEMEDPOSITIVE>` +
    `<AMOUNT>${formatAmount(entry.amount)}</AMOUNT>` +
    '</ALLLEDGERENTRIES.LIST>'
  );
}

export function buildVoucherXml(payload: VoucherPayload): string {
  const entries = payload.entries.filter((e) => Math.abs(e.amount) >= ZERO_THRESHOLD);

  const sum = entries.reduce((acc, e) => acc + e.amount, 0);
  if (Math.abs(sum) > BALANCE_TOLERANCE) {
    throw new Error(`Voucher does not balance: entries sum to ${formatAmount(sum)}, expected 0.00`);
  }

  const party = escapeXml(payload.party.ledgerName);

  return (
    '<ENVELOPE>' +
    '<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>' +
    '<BODY><IMPORTDATA>' +
    '<REQUESTDESC>' +
    '<REPORTNAME>Vouchers</REPORTNAME>' +
    `<STATICVARIABLES><SVCURRENTCOMPANY>${escapeXml(payload.company)}</SVCURRENTCOMPANY></STATICVARIABLES>` +
    '</REQUESTDESC>' +
    '<REQUESTDATA>' +
    '<TALLYMESSAGE xmlns:UDF="TallyUDF">' +
    // ACTION stays "Create" even for a re-push: when Tally already knows the REMOTEID it treats the
    // import as an alter of that voucher rather than a new one.
    `<VOUCHER VCHTYPE="${escapeXml(payload.voucherType)}" ACTION="Create" OBJVIEW="${VOUCHER_VIEW}">` +
    `<REMOTEID>${escapeXml(payload.remoteId)}</REMOTEID>` +
    `<DATE>${escapeXml(payload.date)}</DATE>` +
    `<EFFECTIVEDATE>${escapeXml(payload.date)}</EFFECTIVEDATE>` +
    `<VOUCHERTYPENAME>${escapeXml(payload.voucherType)}</VOUCHERTYPENAME>` +
    `<VOUCHERNUMBER>${escapeXml(payload.billNo)}</VOUCHERNUMBER>` +
    `<REFERENCE>${escapeXml(payload.billNo)}</REFERENCE>` +
    `<PARTYLEDGERNAME>${party}</PARTYLEDGERNAME>` +
    `<PARTYNAME>${party}</PARTYNAME>` +
    (payload.party.gstin ? `<PARTYGSTIN>${escapeXml(payload.party.gstin)}</PARTYGSTIN>` : '') +
    (payload.party.stateName ? `<STATENAME>${escapeXml(payload.party.stateName)}</STATENAME>` : '') +
    (payload.narration ? `<NARRATION>${escapeXml(payload.narration)}</NARRATION>` : '') +
    `<PERSISTEDVIEW>${VOUCHER_VIEW}</PERSISTEDVIEW>` +
    entries.map(ledgerEntryXml).join('') +
    '</VOUCHER>' +
    '</TALLYMESSAGE>' +
    '</REQUESTDATA>' +
    '</IMPORTDATA></BODY>' +
    '</ENVELOPE>'
  );
}
