import { parseTallyResponse } from './parseTallyResponse';

const created = `<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER>
<BODY><DATA><IMPORTRESULT>
<CREATED>1</CREATED><ALTERED>0</ALTERED><LASTVCHID>1042</LASTVCHID>
<IGNORED>0</IGNORED><ERRORS>0</ERRORS><EXCEPTIONS>0</EXCEPTIONS>
</IMPORTRESULT></DATA></BODY></ENVELOPE>`;

const altered = created.replace('<CREATED>1</CREATED><ALTERED>0</ALTERED>', '<CREATED>0</CREATED><ALTERED>1</ALTERED>');

const lineError = `<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>0</STATUS></HEADER>
<BODY><DATA><LINEERROR>Ledger 'KILLICK NIXON LTD' does not exist!</LINEERROR></DATA></BODY></ENVELOPE>`;

const ignored = `<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><IMPORTRESULT>
<CREATED>0</CREATED><ALTERED>0</ALTERED><IGNORED>1</IGNORED>
<ERRORS>0</ERRORS><EXCEPTIONS>0</EXCEPTIONS>
</IMPORTRESULT></DATA></BODY></ENVELOPE>`;

const withErrors = `<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><IMPORTRESULT>
<CREATED>0</CREATED><ALTERED>0</ALTERED><IGNORED>0</IGNORED>
<ERRORS>1</ERRORS><EXCEPTIONS>0</EXCEPTIONS>
</IMPORTRESULT></DATA></BODY></ENVELOPE>`;

describe('parseTallyResponse', () => {
  it('reports a created voucher with its LASTVCHID', () => {
    const r = parseTallyResponse(created);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action).toBe('created');
      expect(r.voucherId).toBe('1042');
    }
  });

  it('reports an altered voucher', () => {
    const r = parseTallyResponse(altered);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action).toBe('altered');
  });

  it('surfaces LINEERROR text verbatim as a failure', () => {
    const r = parseTallyResponse(lineError);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorCode).toBe('TALLY_LINEERROR');
      expect(r.error).toContain("Ledger 'KILLICK NIXON LTD' does not exist!");
    }
  });

  it('treats created=0 and altered=0 as failure, not success', () => {
    // Tally answers HTTP 200 here. Trusting the status code would mark this invoice synced.
    const r = parseTallyResponse(ignored);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('TALLY_NO_CHANGE');
  });

  it('treats a non-zero ERRORS count as failure', () => {
    const r = parseTallyResponse(withErrors);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('TALLY_LINEERROR');
  });

  it('fails loudly on unparseable output rather than guessing', () => {
    const r = parseTallyResponse('<html>404 Not Found</html>');
    expect(r.ok).toBe(false);
  });

  it('fails when the port answers but is not Tally', () => {
    const r = parseTallyResponse('{"hello":"world"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Tally/i);
  });

  it('always returns the raw XML for diagnosis', () => {
    expect(parseTallyResponse(lineError).rawXml).toBe(lineError);
  });
});
