import { buildVoucherLookupXml, voucherNumberPresent } from './buildVoucherLookupXml';

describe('buildVoucherLookupXml', () => {
  it('asks only for the bill date, not the whole year', () => {
    const xml = buildVoucherLookupXml('PRATHAM TEST COMPANY', '20260814');
    expect(xml).toContain('<SVFROMDATE>20260814</SVFROMDATE>');
    expect(xml).toContain('<SVTODATE>20260814</SVTODATE>');
    expect(xml).toContain('<SVCURRENTCOMPANY>PRATHAM TEST COMPANY</SVCURRENTCOMPANY>');
  });

  it('is a read-only Export, never an import', () => {
    const xml = buildVoucherLookupXml('C', '20260814');
    expect(xml).toContain('<TALLYREQUEST>Export</TALLYREQUEST>');
    expect(xml).not.toContain('Import');
    expect(xml).not.toContain('ACTION=');
  });

  it('escapes the company name', () => {
    expect(buildVoucherLookupXml('R & B LTD', '20260814')).toContain('<SVCURRENTCOMPANY>R &amp; B LTD</SVCURRENTCOMPANY>');
  });
});

describe('voucherNumberPresent', () => {
  // Shaped like the client's Tally: a manually-numbered voucher carries the bill number in
  // VOUCHERNUMBER, an auto-numbered one only in REFERENCE.
  const manual = `<ENVELOPE><BODY><DATA><COLLECTION>
    <VOUCHER><VOUCHERNUMBER>T/2982/2026-27</VOUCHERNUMBER><REFERENCE>T/2982/2026-27</REFERENCE></VOUCHER>
  </COLLECTION></DATA></BODY></ENVELOPE>`;

  const auto = `<ENVELOPE><BODY><DATA><COLLECTION>
    <VOUCHER><VOUCHERNUMBER>4</VOUCHERNUMBER><REFERENCE>T/2982/2026-27</REFERENCE></VOUCHER>
  </COLLECTION></DATA></BODY></ENVELOPE>`;

  const other = `<ENVELOPE><BODY><DATA><COLLECTION>
    <VOUCHER><VOUCHERNUMBER>AGY/39/2026-27</VOUCHERNUMBER><REFERENCE>AGY/39/2026-27</REFERENCE></VOUCHER>
  </COLLECTION></DATA></BODY></ENVELOPE>`;

  const empty = `<ENVELOPE><BODY><DATA><COLLECTION></COLLECTION></DATA></BODY></ENVELOPE>`;

  it('finds the bill number in VOUCHERNUMBER', () => {
    expect(voucherNumberPresent(manual, 'T/2982/2026-27')).toBe(true);
  });

  it('finds it in REFERENCE when Tally numbered the voucher itself', () => {
    // Under the built-in Sales type Tally discards our number, so REFERENCE is the only place it
    // survives. Missing this would let every such invoice import a second time.
    expect(voucherNumberPresent(auto, 'T/2982/2026-27')).toBe(true);
  });

  it('does not match a different bill', () => {
    expect(voucherNumberPresent(other, 'T/2982/2026-27')).toBe(false);
  });

  it('reports nothing for an empty day', () => {
    expect(voucherNumberPresent(empty, 'T/2982/2026-27')).toBe(false);
  });

  it('ignores case and surrounding whitespace', () => {
    const padded = `<VOUCHER><VOUCHERNUMBER>  t/2982/2026-27 </VOUCHERNUMBER></VOUCHER>`;
    expect(voucherNumberPresent(padded, 'T/2982/2026-27')).toBe(true);
  });

  it('matches an escaped ampersand back to the raw bill number', () => {
    const escaped = `<VOUCHER><VOUCHERNUMBER>A&amp;B/1</VOUCHERNUMBER></VOUCHER>`;
    expect(voucherNumberPresent(escaped, 'A&B/1')).toBe(true);
  });

  it('never reports a match for a blank bill number', () => {
    // A blank must not match the empty tags Tally returns, or nothing would ever import.
    expect(voucherNumberPresent(manual, '')).toBe(false);
    expect(voucherNumberPresent(`<VOUCHERNUMBER></VOUCHERNUMBER>`, '')).toBe(false);
  });
});
