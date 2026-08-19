import { buildLedgerLookupXml, ledgerNamesIn, ledgersRequiredBy, missingLedgers } from './buildLedgerLookupXml';
import { buildMastersImportXml } from './buildMastersXml';
import { InvoicePayload } from '../types';

const payload: InvoicePayload = {
  remoteId: 'TMS-INV-43',
  company: 'PRATHAM TEST COMPANY',
  date: '20260803',
  billNo: 'AGY/39/2026-27',
  party: { ledgerName: 'PRASHANT CASTECH PVT LTD' },
  lines: [{ ledgerName: '.FREIGHT CHARGES', amount: 4800, gstRate: 18 }],
  taxes: [
    { ledgerName: 'OUTPUT CGST @ 9 %', amount: 432, dutyHead: 'CGST', gstRate: 9 },
    { ledgerName: 'OUTPUT SGST @ 9%', amount: 432, dutyHead: 'SGST', gstRate: 9 },
  ],
  total: 5664,
};

describe('buildLedgerLookupXml', () => {
  it('is a read-only Export scoped to the company', () => {
    const xml = buildLedgerLookupXml('PRATHAM TEST COMPANY');
    expect(xml).toContain('<TALLYREQUEST>Export</TALLYREQUEST>');
    expect(xml).toContain('<SVCURRENTCOMPANY>PRATHAM TEST COMPANY</SVCURRENTCOMPANY>');
    expect(xml).not.toContain('ACTION=');
  });
});

describe('ledgerNamesIn', () => {
  it('reads the names Tally returned, unescaped', () => {
    const set = ledgerNamesIn('<LEDGER NAME="Cash"/><LEDGER NAME="R &amp; B LTD"/>');
    expect(set.has('cash')).toBe(true);
    expect(set.has('r & b ltd')).toBe(true);
  });
});

describe('ledgersRequiredBy', () => {
  it('lists party, sales and tax ledgers', () => {
    expect(ledgersRequiredBy(payload)).toEqual([
      'PRASHANT CASTECH PVT LTD',
      '.FREIGHT CHARGES',
      'OUTPUT CGST @ 9 %',
      'OUTPUT SGST @ 9%',
    ]);
  });

  it('keeps the original spelling when de-duplicating', () => {
    // Tally matches verbatim, so a lower-cased name would create a second, differently-cased ledger.
    const dup = { ...payload, lines: [{ ledgerName: 'Sales', amount: 1 }, { ledgerName: 'SALES', amount: 1 }] } as InvoicePayload;
    expect(ledgersRequiredBy(dup)).toContain('Sales');
    expect(ledgersRequiredBy(dup)).not.toContain('SALES');
  });
});

describe('missingLedgers', () => {
  it('names only what Tally does not already have', () => {
    const existing = new Set(['cash', '.freight charges', 'output cgst @ 9 %']);
    expect(missingLedgers(payload, existing)).toEqual(['PRASHANT CASTECH PVT LTD', 'OUTPUT SGST @ 9%']);
  });

  it('returns nothing when the company already has them all', () => {
    const existing = new Set(ledgersRequiredBy(payload).map((n) => n.toLowerCase()));
    expect(missingLedgers(payload, existing)).toEqual([]);
  });

  it('ignores case and spacing differences', () => {
    expect(missingLedgers(payload, new Set(['  prashant castech pvt ltd  '.trim()]))).not.toContain(
      'PRASHANT CASTECH PVT LTD',
    );
  });
});

describe('buildMastersImportXml', () => {
  it('creates only the ledgers it was asked for', () => {
    const xml = buildMastersImportXml(payload, ['OUTPUT SGST @ 9%']);
    expect(xml).toContain('<LEDGER NAME="OUTPUT SGST @ 9%"');
    expect(xml).not.toContain('PRASHANT CASTECH');
    expect(xml).not.toContain('.FREIGHT CHARGES');
  });

  it('wraps them in a complete import envelope', () => {
    // buildMastersXml alone returns bare TALLYMESSAGE blocks, which Tally cannot accept.
    const xml = buildMastersImportXml(payload, ['OUTPUT SGST @ 9%']);
    expect(xml.startsWith('<ENVELOPE>')).toBe(true);
    expect(xml).toContain('<TALLYREQUEST>Import Data</TALLYREQUEST>');
    expect(xml).toContain('<REPORTNAME>All Masters</REPORTNAME>');
    expect(xml).toContain('<SVCURRENTCOMPANY>PRATHAM TEST COMPANY</SVCURRENTCOMPANY>');
  });
});
