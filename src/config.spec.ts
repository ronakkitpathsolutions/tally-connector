import { loadConfig } from './config';

const base = {
  PORT: '4000',
  SHARED_SECRET: 's3cret',
  TALLY_HOST: '127.0.0.1',
  TALLY_PORT: '9000',
  DEFAULT_COMPANY: 'PRATHAM TRANSPORT PVT LTD',
};

describe('loadConfig', () => {
  it('parses numeric fields and defaults host to 127.0.0.1', () => {
    const c = loadConfig(base as NodeJS.ProcessEnv);
    expect(c.port).toBe(4000);
    expect(c.tallyPort).toBe(9000);
    expect(c.host).toBe('127.0.0.1');
    expect(c.defaultCompany).toBe('PRATHAM TRANSPORT PVT LTD');
  });

  it('throws when SHARED_SECRET is missing', () => {
    const { SHARED_SECRET, ...rest } = base;
    expect(() => loadConfig(rest as NodeJS.ProcessEnv)).toThrow(/SHARED_SECRET/);
  });

  it('throws when DEFAULT_COMPANY is missing', () => {
    const { DEFAULT_COMPANY, ...rest } = base;
    expect(() => loadConfig(rest as NodeJS.ProcessEnv)).toThrow(/DEFAULT_COMPANY/);
  });

  it('never binds 0.0.0.0 even if asked', () => {
    // Binding a wider interface would expose the connector to the client's whole office LAN.
    const c = loadConfig({ ...base, HOST: '0.0.0.0' } as NodeJS.ProcessEnv);
    expect(c.host).toBe('127.0.0.1');
  });
});
