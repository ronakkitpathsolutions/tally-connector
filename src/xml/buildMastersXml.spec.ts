import { buildMastersXml } from './buildMastersXml';
import { buildInvoiceXml } from './buildInvoiceXml';
import { InvoicePayload } from '../types';

const payload: InvoicePayload = {
  remoteId: 'TMS-INV-44',
  company: 'PRATHAM TEST COMPANY',
  date: '20260814',
  billNo: 'T/2982/2026-27',
  party: {
    ledgerName: 'KAIRA DISTRICT CO-OP MILK PRODUCERS UNION LTD - MH',
    gstin: '27AAAAK8694F2Z9',
    stateName: 'Maharashtra',
  },
  lines: [
    { ledgerName: 'SALES IGST', amount: 80000, sacCode: '99651100', gstRate: 18, description: 'Freight Charges' },
    { ledgerName: 'SALES IGST', amount: 3200, sacCode: '996711', gstRate: 18, description: 'Lolo Income' },
  ],
  taxes: [{ ledgerName: 'IGST (O/P)', amount: 14976, dutyHead: 'IGST', gstRate: 18 }],
  total: 98176,
};

describe('buildMastersXml', () => {
  it('creates the party under Sundry Debtors with its GST details', () => {
    const xml = buildMastersXml(payload);
    expect(xml).toContain('<LEDGER NAME="KAIRA DISTRICT CO-OP MILK PRODUCERS UNION LTD - MH" ACTION="Create">');
    expect(xml).toContain('<PARENT>Sundry Debtors</PARENT>');
    expect(xml).toContain('<PARTYGSTIN>27AAAAK8694F2Z9</PARTYGSTIN>');
    expect(xml).toContain('<ISBILLWISEON>Yes</ISBILLWISEON>');
  });

  it('creates the sales ledger under Sales Accounts', () => {
    expect(buildMastersXml(payload)).toContain('<PARENT>Sales Accounts</PARENT>');
  });

  it('creates a tax ledger with Tally\'s own duty-head name', () => {
    // Tally names these "Central Tax" / "State Tax" / "Integrated Tax", not CGST/SGST/IGST.
    const xml = buildMastersXml(payload);
    expect(xml).toContain('<PARENT>Duties &amp; Taxes</PARENT>');
    expect(xml).toContain('<TAXTYPE>GST</TAXTYPE>');
    expect(xml).toContain('<GSTDUTYHEAD>Integrated Tax</GSTDUTYHEAD>');
  });

  it('maps each duty head to its Tally name', () => {
    const intra = buildMastersXml({
      ...payload,
      taxes: [
        { ledgerName: 'CGST (O/P)', amount: 432, dutyHead: 'CGST', gstRate: 9 },
        { ledgerName: 'SGST (O/P)', amount: 432, dutyHead: 'SGST', gstRate: 9 },
      ],
      lines: [{ ledgerName: 'SALES GST', amount: 4800, gstRate: 18 }],
      total: 5664,
    });
    expect(intra).toContain('<GSTDUTYHEAD>Central Tax</GSTDUTYHEAD>');
    expect(intra).toContain('<GSTDUTYHEAD>State Tax</GSTDUTYHEAD>');
  });

  it('creates a repeated sales ledger only once', () => {
    // Both charge lines post to SALES IGST; creating it twice would make Tally complain.
    const xml = buildMastersXml(payload);
    expect(xml.match(/<LEDGER NAME="SALES IGST"/g)).toHaveLength(1);
  });

  it('escapes ampersands in a party name', () => {
    const xml = buildMastersXml({ ...payload, party: { ledgerName: 'R & B LOGISTICS' } });
    expect(xml).toContain('<LEDGER NAME="R &amp; B LOGISTICS"');
    expect(xml).not.toMatch(/NAME="R & B/);
  });

  it('creates a round-off ledger under Indirect Expenses', () => {
    const xml = buildMastersXml({
      ...payload,
      roundOff: 0.24,
      roundOffLedgerName: 'ROUND OFF A/C',
      total: 98176.24,
    });
    expect(xml).toContain('<LEDGER NAME="ROUND OFF A/C"');
    expect(xml).toContain('<PARENT>Indirect Expenses</PARENT>');
  });
});

describe('buildInvoiceXml with createMasters', () => {
  it('omits ledger creation by default', () => {
    const xml = buildInvoiceXml(payload);
    expect(xml).not.toContain('ACTION="Create"><NAME>');
    expect(xml).not.toContain('<PARENT>');
  });

  it('puts the ledgers before the voucher, so it finds them', () => {
    const xml = buildInvoiceXml(payload, { createMasters: true });
    expect(xml).toContain('<PARENT>Sundry Debtors</PARENT>');
    expect(xml.indexOf('<LEDGER NAME=')).toBeLessThan(xml.indexOf('<VOUCHER '));
  });

  it('still balances and still carries the remoteId with masters enabled', () => {
    const xml = buildInvoiceXml(payload, { createMasters: true });
    expect(xml).toContain('<REMOTEID>TMS-INV-44</REMOTEID>');
    expect(xml).toContain('<AMOUNT>-98176.00</AMOUNT>');
  });
});
