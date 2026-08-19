import { escapeXml } from './escape';

/**
 * Asks Tally for the vouchers dated on one day, so a bill number can be checked before importing.
 *
 * This exists because REMOTEID does not deduplicate. TallyPrime accepted the same voucher twice —
 * verified against the client's Tally, where a second import of one invoice produced a second
 * voucher rather than altering the first. Everything in the retry design assumed otherwise, so
 * without a check-before-import a timeout or a retry writes double sales into the client's books.
 *
 * Scoped to the bill's own date rather than the whole year: a day's vouchers is a small, bounded
 * response, while a year of a live company is not.
 */
export function buildVoucherLookupXml(company: string, date: string): string {
  return (
    '<ENVELOPE>' +
    '<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>VchLookup</ID></HEADER>' +
    '<BODY><DESC><STATICVARIABLES>' +
    `<SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>` +
    `<SVFROMDATE>${escapeXml(date)}</SVFROMDATE>` +
    `<SVTODATE>${escapeXml(date)}</SVTODATE>` +
    '</STATICVARIABLES>' +
    '<TDL><TDLMESSAGE>' +
    '<COLLECTION NAME="VchLookup" ISINITIALIZE="Yes">' +
    '<TYPE>Voucher</TYPE>' +
    '<NATIVEMETHOD>VoucherNumber</NATIVEMETHOD>' +
    '<NATIVEMETHOD>Reference</NATIVEMETHOD>' +
    '</COLLECTION>' +
    '</TDLMESSAGE></TDL>' +
    '</DESC></BODY>' +
    '</ENVELOPE>'
  );
}

/**
 * True when that day already holds a voucher carrying this bill number.
 *
 * Both fields are checked: Tally puts our number in VOUCHERNUMBER when the voucher type numbers
 * manually, and only in REFERENCE when it numbers automatically and stamps its own sequence.
 */
export function voucherNumberPresent(xml: string, billNo: string): boolean {
  const wanted = billNo.trim().toLowerCase();
  if (!wanted) return false;

  const values = [...xml.matchAll(/<(?:VOUCHERNUMBER|REFERENCE)>([^<]*)<\/(?:VOUCHERNUMBER|REFERENCE)>/g)].map((m) =>
    m[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .trim()
      .toLowerCase(),
  );

  return values.includes(wanted);
}
