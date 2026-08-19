import { buildInvoiceXml } from './buildInvoiceXml';
import { InvoicePayload } from '../types';

// Invoice #44 — T/2982/2026-27. Inter-state, IGST, two charge types on two different SAC codes.
const igstInvoice: InvoicePayload = {
  remoteId: 'TMS-INV-44',
  company: 'PRATHAM TRANSPORT PVT LTD',
  date: '20260805',
  billNo: 'T/2982/2026-27',
  narration: 'NHAVA SHEVA - KHATRAJ - NHAVA SHEVA',
  party: {
    ledgerName: 'KILLICK NIXON LTD',
    gstin: '27AAACK1234A1Z5',
    stateName: 'Maharashtra',
    placeOfSupply: 'Maharashtra',
    address: ['Killick House', 'Nhava Sheva'],
    registrationType: 'Regular',
  },
  lines: [
    { ledgerName: 'SALES IGST', amount: 80000, sacCode: '99651100', gstRate: 18, description: 'Freight Charges' },
    { ledgerName: 'SALES IGST', amount: 3200, sacCode: '996711', gstRate: 18, description: 'Lolo Income' },
  ],
  taxes: [{ ledgerName: 'IGST (O/P)', amount: 14976, dutyHead: 'IGST', gstRate: 18 }],
  roundOff: 0,
  total: 98176,
};

// Invoice #43 — AGY/39/2026-27. Intra-state, CGST + SGST, single charge type.
const cgstInvoice: InvoicePayload = {
  remoteId: 'TMS-INV-43',
  company: 'PRATHAM TRANSPORT PVT LTD',
  date: '20260722',
  billNo: 'AGY/39/2026-27',
  party: { ledgerName: 'PRASHANT CASTECH PVT LTD', stateName: 'Gujarat', placeOfSupply: 'Gujarat' },
  lines: [{ ledgerName: 'SALES GST', amount: 4800, gstRate: 18, description: 'Agency Charges' }],
  taxes: [
    { ledgerName: 'CGST (O/P)', amount: 432, dutyHead: 'CGST', gstRate: 9 },
    { ledgerName: 'SGST (O/P)', amount: 432, dutyHead: 'SGST', gstRate: 9 },
  ],
  total: 5664,
};

describe('buildInvoiceXml', () => {
  it('marks the voucher as an invoice, not a plain accounting voucher', () => {
    const xml = buildInvoiceXml(igstInvoice);
    expect(xml).toContain('<ISINVOICE>Yes</ISINVOICE>');
    // Accounting, not "Invoice Voucher View": that one is the inventory view and the client's
    // TallyPrime rejects it outright for a services bill.
    expect(xml).toContain('OBJVIEW="Accounting Voucher View"');
    expect(xml).not.toContain('Invoice Voucher View');
    expect(xml).toContain('<REMOTEID>TMS-INV-44</REMOTEID>');
  });

  it('emits the GST buyer block', () => {
    const xml = buildInvoiceXml(igstInvoice);
    expect(xml).toContain('<BASICBUYERNAME>KILLICK NIXON LTD</BASICBUYERNAME>');
    expect(xml).toContain('<PARTYGSTIN>27AAACK1234A1Z5</PARTYGSTIN>');
    expect(xml).toContain('<PLACEOFSUPPLY>Maharashtra</PLACEOFSUPPLY>');
    expect(xml).toContain('<COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>');
    expect(xml).toContain('<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>');
  });

  it('emits each address line as its own BASICBUYERADDRESS', () => {
    const xml = buildInvoiceXml(igstInvoice);
    expect(xml).toContain(
      '<BASICBUYERADDRESS.LIST>' +
        '<BASICBUYERADDRESS>Killick House</BASICBUYERADDRESS>' +
        '<BASICBUYERADDRESS>Nhava Sheva</BASICBUYERADDRESS>' +
        '</BASICBUYERADDRESS.LIST>',
    );
  });

  it('keeps each charge type as its own ledger line with its own SAC', () => {
    const xml = buildInvoiceXml(igstInvoice);
    // party + 2 sales lines + 1 tax = 4
    expect(xml.match(/<ALLLEDGERENTRIES\.LIST>/g)).toHaveLength(4);
    expect(xml).toContain('<HSNCODE>99651100</HSNCODE>');
    expect(xml).toContain('<HSNCODE>996711</HSNCODE>');
    expect(xml).toContain('<AMOUNT>80000.00</AMOUNT>');
    expect(xml).toContain('<AMOUNT>3200.00</AMOUNT>');
  });

  it('carries the GST rate and duty head on each tax line', () => {
    const xml = buildInvoiceXml(cgstInvoice);
    expect(xml).toContain('<GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD>');
    expect(xml).toContain('<GSTRATEDUTYHEAD>SGST</GSTRATEDUTYHEAD>');
    expect(xml).not.toContain('<GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD>');
  });

  it('debits the party by the grand total', () => {
    const xml = buildInvoiceXml(igstInvoice);
    expect(xml).toContain(
      '<ALLLEDGERENTRIES.LIST><LEDGERNAME>KILLICK NIXON LTD</LEDGERNAME>' +
        '<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-98176.00</AMOUNT></ALLLEDGERENTRIES.LIST>',
    );
  });

  it('builds the intra-state invoice with four entries', () => {
    // party + 1 sales + 2 tax
    expect(buildInvoiceXml(cgstInvoice).match(/<ALLLEDGERENTRIES\.LIST>/g)).toHaveLength(4);
  });

  it('omits a zero round-off', () => {
    expect(buildInvoiceXml(igstInvoice)).not.toContain('ROUND OFF');
  });

  it('includes a non-zero round-off as its own line', () => {
    const xml = buildInvoiceXml({
      ...igstInvoice,
      roundOff: 0.24,
      total: 98176.24,
      roundOffLedgerName: 'ROUND OFF A/C',
    });
    expect(xml).toContain('<LEDGERNAME>ROUND OFF A/C</LEDGERNAME>');
    expect(xml).toContain('<AMOUNT>0.24</AMOUNT>');
  });

  it('rejects a non-zero round-off with no ledger to post it to', () => {
    expect(() => buildInvoiceXml({ ...igstInvoice, roundOff: 0.24, total: 98176.24 })).toThrow(/round.?off/i);
  });

  it('rejects an invoice whose lines and taxes do not add up to the total', () => {
    // The strict check: a backend total that disagrees with its own line items is caught here,
    // not by Tally, and not silently posted.
    expect(() => buildInvoiceXml({ ...igstInvoice, total: 99000 })).toThrow(/total/i);
  });

  it('tolerates floating-point dust within half a paisa', () => {
    expect(() => buildInvoiceXml({ ...igstInvoice, total: 98176.001 })).not.toThrow();
  });

  it('rejects an invoice with no sales lines', () => {
    expect(() => buildInvoiceXml({ ...igstInvoice, lines: [], total: 14976 })).toThrow(/line/i);
  });

  it('escapes ampersands everywhere they can appear', () => {
    const xml = buildInvoiceXml({
      ...cgstInvoice,
      party: { ...cgstInvoice.party, ledgerName: 'R & B LOGISTICS' },
      lines: [{ ...cgstInvoice.lines[0], description: 'Freight & Handling' }],
    });
    expect(xml).toContain('<BASICBUYERNAME>R &amp; B LOGISTICS</BASICBUYERNAME>');
    expect(xml).toContain('Freight &amp; Handling');
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  it('produces well-formed XML for both fixtures', () => {
    for (const payload of [igstInvoice, cgstInvoice]) {
      const xml = buildInvoiceXml(payload);
      expect(xml.startsWith('<ENVELOPE>')).toBe(true);
      expect(xml.endsWith('</ENVELOPE>')).toBe(true);
      expect(xml.match(/</g)!.length).toBe(xml.match(/>/g)!.length);
    }
  });
});
