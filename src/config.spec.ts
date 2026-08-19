import { loadConfig } from './config';

const base = {
  PORT: '4000',
  SHARED_SECRET: 's3cret',
  DEFAULT_COMPANY: 'PRATHAM TRANSPORT PVT LTD',
};

describe('loadConfig', () => {
  it('parses numeric fields and defaults host to 127.0.0.1', () => {
    const c = loadConfig(base as NodeJS.ProcessEnv);
    expect(c.port).toBe(4000);
    expect(c.tallyPort).toBe(9001);
    expect(c.host).toBe('127.0.0.1');
    expect(c.defaultCompany).toBe('PRATHAM TRANSPORT PVT LTD');
  });

  it('honours an explicit TALLY_PORT', () => {
    expect(loadConfig({ ...base, TALLY_PORT: '9000' } as NodeJS.ProcessEnv).tallyPort).toBe(9000);
  });

  it('defaults both the bind address and the Tally host to loopback', () => {
    const c = loadConfig(base as NodeJS.ProcessEnv);
    expect(c.host).toBe('127.0.0.1');
    expect(c.tallyHost).toBe('127.0.0.1');
  });

  it('uses HOST for both, since Tally runs on the same PC', () => {
    const c = loadConfig({ ...base, HOST: '192.168.0.92' } as NodeJS.ProcessEnv);
    expect(c.host).toBe('192.168.0.92');
    expect(c.tallyHost).toBe('192.168.0.92');
  });

  it('falls back to loopback for a blank HOST', () => {
    // An empty value in .env must not turn into a bind on '' — that binds every interface.
    expect(loadConfig({ ...base, HOST: '' } as NodeJS.ProcessEnv).host).toBe('127.0.0.1');
    expect(loadConfig({ ...base, HOST: '   ' } as NodeJS.ProcessEnv).host).toBe('127.0.0.1');
  });

  it('throws when SHARED_SECRET is missing', () => {
    const { SHARED_SECRET, ...rest } = base;
    expect(() => loadConfig(rest as NodeJS.ProcessEnv)).toThrow(/SHARED_SECRET/);
  });

  it('throws when DEFAULT_COMPANY is missing', () => {
    const { DEFAULT_COMPANY, ...rest } = base;
    expect(() => loadConfig(rest as NodeJS.ProcessEnv)).toThrow(/DEFAULT_COMPANY/);
  });

  it('leaves educational mode off unless explicitly enabled', () => {
    // The dangerous default is "on". Anything other than an explicit true/1 must read as off.
    expect(loadConfig(base as NodeJS.ProcessEnv).eduMode).toBe(false);
    expect(loadConfig({ ...base, TALLY_EDU_MODE: 'false' } as NodeJS.ProcessEnv).eduMode).toBe(false);
    expect(loadConfig({ ...base, TALLY_EDU_MODE: 'yes' } as NodeJS.ProcessEnv).eduMode).toBe(false);
    expect(loadConfig({ ...base, TALLY_EDU_MODE: '' } as NodeJS.ProcessEnv).eduMode).toBe(false);
  });

  it('enables educational mode on true or 1', () => {
    expect(loadConfig({ ...base, TALLY_EDU_MODE: 'true' } as NodeJS.ProcessEnv).eduMode).toBe(true);
    expect(loadConfig({ ...base, TALLY_EDU_MODE: '1' } as NodeJS.ProcessEnv).eduMode).toBe(true);
  });

  it('honours an explicit 0.0.0.0', () => {
    // Allowed, but it binds every interface — the shared secret is then the only thing guarding
    // :4000. Kept as a test so the exposure is a stated behaviour rather than an accident.
    expect(loadConfig({ ...base, HOST: '0.0.0.0' } as NodeJS.ProcessEnv).host).toBe('0.0.0.0');
  });
});
