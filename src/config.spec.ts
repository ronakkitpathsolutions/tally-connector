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

  it('binds where HOST says, but always reaches Tally on loopback', () => {
    const c = loadConfig({ ...base, HOST: '192.168.0.92' } as NodeJS.ProcessEnv);
    expect(c.host).toBe('192.168.0.92');
    // Tally is on this machine; the bind address has nothing to do with reaching it.
    expect(c.tallyHost).toBe('127.0.0.1');
  });

  it('accepts 0.0.0.0 so localhost and the LAN address both answer', () => {
    // Binding one LAN address does not also cover loopback, so http://localhost:4000 would refuse.
    // 0.0.0.0 is the only value that serves both.
    const c = loadConfig({ ...base, HOST: '0.0.0.0' } as NodeJS.ProcessEnv);
    expect(c.host).toBe('0.0.0.0');
    // ...and it must not leak into the Tally target, which would be unconnectable.
    expect(c.tallyHost).toBe('127.0.0.1');
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

  it('accepts the casings someone actually types in a .env', () => {
    // Exact-'true' matching meant TRUE and True read as off while looking set in the file.
    for (const v of ['TRUE', 'True', 'yes', 'YES', 'on', ' true ']) {
      expect(loadConfig({ ...base, ALLOW_MASTER_CREATE: v } as NodeJS.ProcessEnv).allowMasterCreate).toBe(true);
    }
  });

  it('still treats anything else as off', () => {
    for (const v of ['false', 'FALSE', 'no', '0', '', '  ']) {
      expect(loadConfig({ ...base, ALLOW_MASTER_CREATE: v } as NodeJS.ProcessEnv).allowMasterCreate).toBe(false);
    }
  });


});
