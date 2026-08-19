import { InvoiceLine, InvoicePayload, TaxLine } from '../types';
import { escapeXml, formatAmount } from './escape';
import { buildMastersXml } from './buildMastersXml';

/** Half a paisa — rounded GST halves routinely leave sub-paisa dust. */
// "Invoice Voucher View" is the inventory/stock-item view and TallyPrime throws it out as an
// exception for a services bill — verified against the client's Tally, where it silently
// returned EXCEPTIONS 1 with no LINEERROR. Freight and agency charges are accounting lines,
// so this is the correct view as well as the one that imports.
const VOUCHER_VIEW = 'Accounting Voucher View';

const TOLERANCE = 0.005;

const isZero = (n: number): boolean => Math.abs(n) < TOLERANCE;

function tag(name: string, value: string | undefined): string {
  return value ? `<${name}>${escapeXml(value)}</${name}>` : '';
}

/**
 * A credited ledger line: sales or tax. Tally's convention is that credited entries carry a
 * positive AMOUNT with ISDEEMEDPOSITIVE No; the party, debited, is the mirror of this.
 */
function creditLine(ledgerName: string, amount: number, extras = ''): string {
  return (
    '<ALLLEDGERENTRIES.LIST>' +
    `<LEDGERNAME>${escapeXml(ledgerName)}</LEDGERNAME>` +
    '<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>' +
    `<AMOUNT>${formatAmount(amount)}</AMOUNT>` +
    extras +
    '</ALLLEDGERENTRIES.LIST>'
  );
}

function salesLineXml(line: InvoiceLine): string {
  // The SAC override goes on the entry rather than relying on the ledger master, so a single
  // "SALES IGST" ledger can carry Freight Charges (99651100) and Lolo Income (996711) on one bill.
  const hsn = line.sacCode
    ? `<GSTOVRDNHSNSACDETAILS.LIST><HSNCODE>${escapeXml(line.sacCode)}</HSNCODE></GSTOVRDNHSNSACDETAILS.LIST>`
    : '';
  const rate =
    line.gstRate === undefined
      ? ''
      : `<RATEDETAILS.LIST><GSTRATEDUTYHEAD>GST</GSTRATEDUTYHEAD><GSTRATE>${line.gstRate}</GSTRATE></RATEDETAILS.LIST>`;

  return creditLine(line.ledgerName, line.amount, tag('REMARKS', line.description) + hsn + rate);
}

function taxLineXml(tax: TaxLine): string {
  const rate =
    tax.gstRate === undefined
      ? ''
      : `<RATEDETAILS.LIST><GSTRATEDUTYHEAD>${escapeXml(tax.dutyHead)}</GSTRATEDUTYHEAD>` +
        `<GSTRATE>${tax.gstRate}</GSTRATE></RATEDETAILS.LIST>`;

  return creditLine(tax.ledgerName, tax.amount, rate);
}

/**
 * Renders a GST Sales Invoice. Services only — freight and agency charges against SAC codes — so
 * there are no INVENTORYENTRIES; every charge posts as its own accounting line.
 */
export function buildInvoiceXml(payload: InvoicePayload, options: { createMasters?: boolean } = {}): string {
  const lines = payload.lines.filter((l) => !isZero(l.amount));
  if (lines.length === 0) {
    throw new Error('Invoice has no sales lines with a non-zero amount');
  }

  const taxes = payload.taxes.filter((t) => !isZero(t.amount));
  const roundOff = payload.roundOff ?? 0;

  if (!isZero(roundOff) && !payload.roundOffLedgerName?.trim()) {
    throw new Error(`Round-off of ${formatAmount(roundOff)} has no round-off ledger name`);
  }

  // Stricter than the plain voucher's "entries sum to zero": here a grand total that disagrees with
  // its own line items is caught before anything is sent, rather than posting a wrong figure.
  const computed = [...lines, ...taxes].reduce((sum, e) => sum + e.amount, 0) + roundOff;
  if (Math.abs(computed - payload.total) > TOLERANCE) {
    throw new Error(
      `Invoice does not add up: lines + taxes + roundOff = ${formatAmount(computed)}, ` +
        `but total is ${formatAmount(payload.total)}`,
    );
  }

  const party = escapeXml(payload.party.ledgerName);
  const addressLines = (payload.party.address ?? [])
    .filter((line) => line.trim())
    .map((line) => `<BASICBUYERADDRESS>${escapeXml(line)}</BASICBUYERADDRESS>`)
    .join('');

  return (
    '<ENVELOPE>' +
    '<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>' +
    '<BODY><IMPORTDATA>' +
    '<REQUESTDESC>' +
    '<REPORTNAME>Vouchers</REPORTNAME>' +
    `<STATICVARIABLES><SVCURRENTCOMPANY>${escapeXml(payload.company)}</SVCURRENTCOMPANY></STATICVARIABLES>` +
    '</REQUESTDESC>' +
    '<REQUESTDATA>' +
    // Ledgers first: Tally applies messages in order, so the voucher below finds them already there.
    (options.createMasters ? buildMastersXml(payload) : '') +
    '<TALLYMESSAGE xmlns:UDF="TallyUDF">' +
    // ACTION stays "Create": when Tally already knows the REMOTEID it alters that voucher instead.
    `<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="${VOUCHER_VIEW}">` +
    `<REMOTEID>${escapeXml(payload.remoteId)}</REMOTEID>` +
    `<DATE>${escapeXml(payload.date)}</DATE>` +
    `<EFFECTIVEDATE>${escapeXml(payload.date)}</EFFECTIVEDATE>` +
    '<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>' +
    `<VOUCHERNUMBER>${escapeXml(payload.billNo)}</VOUCHERNUMBER>` +
    `<REFERENCE>${escapeXml(payload.billNo)}</REFERENCE>` +
    `<REFERENCEDATE>${escapeXml(payload.date)}</REFERENCEDATE>` +
    '<ISINVOICE>Yes</ISINVOICE>' +
    `<PARTYLEDGERNAME>${party}</PARTYLEDGERNAME>` +
    `<PARTYNAME>${party}</PARTYNAME>` +
    `<BASICBUYERNAME>${party}</BASICBUYERNAME>` +
    (addressLines ? `<BASICBUYERADDRESS.LIST>${addressLines}</BASICBUYERADDRESS.LIST>` : '') +
    tag('PARTYGSTIN', payload.party.gstin) +
    tag('STATENAME', payload.party.stateName) +
    tag('PLACEOFSUPPLY', payload.party.placeOfSupply ?? payload.party.stateName) +
    '<COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>' +
    tag('GSTREGISTRATIONTYPE', payload.party.registrationType ?? 'Regular') +
    tag('NARRATION', payload.narration) +
    `<PERSISTEDVIEW>${VOUCHER_VIEW}</PERSISTEDVIEW>` +
    // Party first, then sales, then tax, then round-off — the order Tally lists them in the voucher.
    '<ALLLEDGERENTRIES.LIST>' +
    `<LEDGERNAME>${party}</LEDGERNAME>` +
    '<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>' +
    `<AMOUNT>${formatAmount(-payload.total)}</AMOUNT>` +
    '</ALLLEDGERENTRIES.LIST>' +
    lines.map(salesLineXml).join('') +
    taxes.map(taxLineXml).join('') +
    (isZero(roundOff) ? '' : creditLine(payload.roundOffLedgerName as string, roundOff)) +
    '</VOUCHER>' +
    '</TALLYMESSAGE>' +
    '</REQUESTDATA>' +
    '</IMPORTDATA></BODY>' +
    '</ENVELOPE>'
  );
}
