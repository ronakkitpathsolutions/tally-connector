import { matchToPayloadLedger, parseMissingLedger } from './parseMissingLedger';

describe('parseMissingLedger', () => {
  it('reads the name from the message the client\'s Tally actually sends', () => {
    expect(parseMissingLedger("Ledger 'PRASHANT CASTECH PVT LTD' does not exist!")).toBe('PRASHANT CASTECH PVT LTD');
  });

  it('reads it when the quotes arrived XML-escaped', () => {
    // The connector unescapes before this runs, but the raw form shows up in logs and retries.
    expect(parseMissingLedger('Ledger &apos;OUTPUT SGST @ 9%&apos; does not exist!')).toBe('OUTPUT SGST @ 9%');
  });

  it('keeps names containing spaces, dots and symbols intact', () => {
    expect(parseMissingLedger("Ledger '.FREIGHT CHARGES' does not exist!")).toBe('.FREIGHT CHARGES');
    expect(parseMissingLedger("Ledger 'OUTPUT CGST @ 9 %' does not exist!")).toBe('OUTPUT CGST @ 9 %');
  });

  it('returns null for an unrelated Tally error', () => {
    expect(parseMissingLedger('Voucher Type does not exist!')).toBeNull();
    expect(parseMissingLedger('The Base Currency Symbol is required!')).toBeNull();
    expect(parseMissingLedger('')).toBeNull();
  });

  it('returns null when the quoted name is empty', () => {
    expect(parseMissingLedger("Ledger '' does not exist!")).toBeNull();
  });
});

describe('matchToPayloadLedger', () => {
  const ledgers = ['PRASHANT CASTECH PVT LTD', '.FREIGHT CHARGES', 'OUTPUT CGST @ 9 %'];

  it('finds the ledger this voucher asked for', () => {
    expect(matchToPayloadLedger('PRASHANT CASTECH PVT LTD', ledgers)).toBe('PRASHANT CASTECH PVT LTD');
  });

  it('returns the payload spelling, not Tally\'s', () => {
    // Tally matches verbatim, so creating it under the casing from an error message would make a
    // second, differently-cased ledger that the voucher still could not find.
    expect(matchToPayloadLedger('prashant castech pvt ltd', ledgers)).toBe('PRASHANT CASTECH PVT LTD');
  });

  it('refuses a name this voucher never mentioned', () => {
    // The safety catch: without it, any "does not exist" text from Tally becomes an instruction to
    // create a ledger in the client's books.
    expect(matchToPayloadLedger('SOME OTHER LEDGER', ledgers)).toBeNull();
    expect(matchToPayloadLedger('Cash', ledgers)).toBeNull();
  });

  it('ignores surrounding whitespace on both sides', () => {
    expect(matchToPayloadLedger('  .FREIGHT CHARGES ', ledgers)).toBe('.FREIGHT CHARGES');
    expect(matchToPayloadLedger('OUTPUT CGST @ 9 %', ['  OUTPUT CGST @ 9 %  '])).toBe('  OUTPUT CGST @ 9 %  ');
  });

  it('returns null for an empty name or an empty voucher', () => {
    expect(matchToPayloadLedger('', ledgers)).toBeNull();
    expect(matchToPayloadLedger('   ', ledgers)).toBeNull();
    expect(matchToPayloadLedger('anything', [])).toBeNull();
  });
});
