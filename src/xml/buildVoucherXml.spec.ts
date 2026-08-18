import { buildVoucherXml } from './buildVoucherXml';
import { VoucherPayload } from '../types';

// Invoice #44 — T/2982/2026-27, inter-state, IGST only, roundOff 0.
const igstPayload: VoucherPayload = {
  remoteId: 'TMS-INV-44',
  company: 'PRATHAM TRANSPORT PVT LTD',
  voucherType: 'Sales',
  date: '20260805',
  billNo: 'T/2982/2026-27',
  narration: 'NHAVA SHEVA - KHATRAJ - NHAVA SHEVA',
  party: { ledgerName: 'KILLICK NIXON LTD', gstin: '27AAACK1234A1Z5', stateName: 'Maharashtra' },
  entries: [
    { ledgerName: 'KILLICK NIXON LTD', amount: -98176, isParty: true },
    { ledgerName: 'SALES IGST', amount: 83200 },
    { ledgerName: 'IGST (O/P)', amount: 14976 },
  ],
};

// Invoice #43 — AGY/39/2026-27, intra-state, CGST + SGST.
const cgstPayload: VoucherPayload = {
  ...igstPayload,
  remoteId: 'TMS-INV-43',
  billNo: 'AGY/39/2026-27',
  party: { ledgerName: 'PRASHANT CASTECH PVT LTD' },
  entries: [
    { ledgerName: 'PRASHANT CASTECH PVT LTD', amount: -5664, isParty: true },
    { ledgerName: 'SALES GST', amount: 4800 },
    { ledgerName: 'CGST (O/P)', amount: 432 },
    { ledgerName: 'SGST (O/P)', amount: 432 },
  ],
};

describe('buildVoucherXml', () => {
  it('emits the import envelope with the company name', () => {
    const xml = buildVoucherXml(igstPayload);
    expect(xml).toContain('<TALLYREQUEST>Import Data</TALLYREQUEST>');
    expect(xml).toContain('<REPORTNAME>Vouchers</REPORTNAME>');
    expect(xml).toContain('<SVCURRENTCOMPANY>PRATHAM TRANSPORT PVT LTD</SVCURRENTCOMPANY>');
  });

  it('carries the remoteId so a retry alters instead of duplicating', () => {
    expect(buildVoucherXml(igstPayload)).toContain('<REMOTEID>TMS-INV-44</REMOTEID>');
  });

  it('debits the party with a negative amount and ISDEEMEDPOSITIVE Yes', () => {
    const xml = buildVoucherXml(igstPayload);
    expect(xml).toContain(
      '<ALLLEDGERENTRIES.LIST><LEDGERNAME>KILLICK NIXON LTD</LEDGERNAME>' +
        '<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-98176.00</AMOUNT></ALLLEDGERENTRIES.LIST>',
    );
  });

  it('credits sales and tax ledgers with positive amounts and ISDEEMEDPOSITIVE No', () => {
    const xml = buildVoucherXml(igstPayload);
    expect(xml).toContain(
      '<ALLLEDGERENTRIES.LIST><LEDGERNAME>SALES IGST</LEDGERNAME>' +
        '<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>83200.00</AMOUNT></ALLLEDGERENTRIES.LIST>',
    );
    expect(xml).toContain('<LEDGERNAME>IGST (O/P)</LEDGERNAME>');
  });

  it('emits four ledger entries for an intra-state CGST+SGST bill', () => {
    const xml = buildVoucherXml(cgstPayload);
    expect(xml.match(/<ALLLEDGERENTRIES\.LIST>/g)).toHaveLength(4);
    expect(xml).toContain('<AMOUNT>432.00</AMOUNT>');
  });

  it('omits zero-amount entries entirely', () => {
    const xml = buildVoucherXml({
      ...igstPayload,
      entries: [...igstPayload.entries, { ledgerName: 'ROUND OFF A/C', amount: 0 }],
    });
    expect(xml).not.toContain('ROUND OFF A/C');
    expect(xml.match(/<ALLLEDGERENTRIES\.LIST>/g)).toHaveLength(3);
  });

  it('rejects an unbalanced voucher before it reaches Tally', () => {
    expect(() =>
      buildVoucherXml({
        ...igstPayload,
        entries: [
          { ledgerName: 'KILLICK NIXON LTD', amount: -98176, isParty: true },
          { ledgerName: 'SALES IGST', amount: 83200 },
        ],
      }),
    ).toThrow(/balance/i);
  });

  it('tolerates floating-point dust within half a paisa', () => {
    expect(() =>
      buildVoucherXml({
        ...igstPayload,
        entries: [
          { ledgerName: 'KILLICK NIXON LTD', amount: -98176.001, isParty: true },
          { ledgerName: 'SALES IGST', amount: 83200 },
          { ledgerName: 'IGST (O/P)', amount: 14976 },
        ],
      }),
    ).not.toThrow();
  });

  it('escapes ampersands in the party name', () => {
    const xml = buildVoucherXml({
      ...igstPayload,
      party: { ledgerName: 'R & B LOGISTICS' },
      entries: [
        { ledgerName: 'R & B LOGISTICS', amount: -98176, isParty: true },
        { ledgerName: 'SALES IGST', amount: 83200 },
        { ledgerName: 'IGST (O/P)', amount: 14976 },
      ],
    });
    expect(xml).toContain('<PARTYLEDGERNAME>R &amp; B LOGISTICS</PARTYLEDGERNAME>');
    expect(xml).not.toMatch(/<PARTYLEDGERNAME>R & B/);
  });

  it('omits optional party fields that are absent', () => {
    const xml = buildVoucherXml(cgstPayload);
    expect(xml).not.toContain('<PARTYGSTIN>');
    expect(xml).not.toContain('<STATENAME>');
  });

  it('produces well-formed XML for both fixtures', () => {
    for (const payload of [igstPayload, cgstPayload]) {
      const xml = buildVoucherXml(payload);
      expect(xml.startsWith('<ENVELOPE>')).toBe(true);
      expect(xml.endsWith('</ENVELOPE>')).toBe(true);
      // Every opened tag is closed: counts of < and > match, and no stray unescaped '&'.
      expect(xml.match(/</g)!.length).toBe(xml.match(/>/g)!.length);
      expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
    }
  });
});
