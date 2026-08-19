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

// Captured verbatim from the client's TallyPrime. This is the shape it actually returns for an
// import: a bare <RESPONSE> root, not the ENVELOPE/BODY/DATA/IMPORTRESULT the docs describe.
const realCreated = `<RESPONSE>\r\n <CREATED>1</CREATED>\r\n <ALTERED>0</ALTERED>\r\n <DELETED>0</DELETED>\r\n <LASTVCHID>7</LASTVCHID>\r\n <LASTMID>0</LASTMID>\r\n <COMBINED>0</COMBINED>\r\n <IGNORED>0</IGNORED>\r\n <ERRORS>0</ERRORS>\r\n <CANCELLED>0</CANCELLED>\r\n <EXCEPTIONS>0</EXCEPTIONS>\r\n</RESPONSE>`;

const realLineError = `<RESPONSE>\r\n <LINEERROR>The Base Currency Symbol is required!</LINEERROR>\r\n <CREATED>0</CREATED>\r\n <ALTERED>0</ALTERED>\r\n <ERRORS>1</ERRORS>\r\n <EXCEPTIONS>0</EXCEPTIONS>\r\n</RESPONSE>`;

const realException = `<RESPONSE>\r\n <CREATED>0</CREATED>\r\n <ALTERED>0</ALTERED>\r\n <LASTVCHID>0</LASTVCHID>\r\n <ERRORS>0</ERRORS>\r\n <EXCEPTIONS>1</EXCEPTIONS>\r\n</RESPONSE>`;

describe('parseTallyResponse — the shape real Tally returns', () => {
  it('reads a bare <RESPONSE> import result as success', () => {
    // This exact response was reported as a FAILURE by the ENVELOPE-only parser, while the voucher
    // had in fact been created. In production that reads as "push failed" and invites a retry,
    // which duplicates the voucher — the worst outcome this system can produce.
    const r = parseTallyResponse(realCreated);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action).toBe('created');
      expect(r.voucherId).toBe('7');
    }
  });

  it('reads a LINEERROR inside a bare <RESPONSE>', () => {
    const r = parseTallyResponse(realLineError);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorCode).toBe('TALLY_LINEERROR');
      expect(r.error).toContain('Base Currency Symbol');
    }
  });

  it('treats a bare <RESPONSE> with only an exception as failure', () => {
    // Tally rejects a voucher this way — EXCEPTIONS 1, no LINEERROR, and an HTTP 200.
    const r = parseTallyResponse(realException);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('TALLY_NO_CHANGE');
  });
});

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
