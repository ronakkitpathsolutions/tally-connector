import fs from 'node:fs';
import { log, redact, setLogSecrets } from './logger';

jest.mock('node:fs', () => ({
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
}));

const mkdir = fs.mkdirSync as unknown as jest.Mock;
const append = fs.appendFileSync as unknown as jest.Mock;

/** The line handed to appendFileSync on the most recent write. */
const lastLine = (): string => String(append.mock.calls[append.mock.calls.length - 1][1]);
const lastPath = (): string => String(append.mock.calls[append.mock.calls.length - 1][0]);

beforeEach(() => {
  jest.clearAllMocks();
  setLogSecrets([]);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('redact', () => {
  it('leaves text alone when no secrets are registered', () => {
    expect(redact('nothing to hide')).toBe('nothing to hide');
  });

  it('blanks every occurrence, not just the first', () => {
    setLogSecrets(['s3cr3t-value']);
    expect(redact('a s3cr3t-value b s3cr3t-value c')).toBe('a *** b *** c');
  });

  it('blanks each registered secret', () => {
    setLogSecrets(['first-secret', 'second-secret']);
    expect(redact('first-secret and second-secret')).toBe('*** and ***');
  });

  it('ignores absent and empty values', () => {
    setLogSecrets([undefined, '', 'real-secret']);
    expect(redact('real-secret stays hidden')).toBe('*** stays hidden');
  });

  it('ignores secrets too short to be distinctive', () => {
    // A three-character "secret" like "abc" would blank out ordinary words and make logs useless.
    setLogSecrets(['abc']);
    expect(redact('abcdefg and abc')).toBe('abcdefg and abc');
  });

  it('redacts a secret embedded in a longer string', () => {
    setLogSecrets(['token-1234']);
    expect(redact('Bearer token-1234;rest')).toBe('Bearer ***;rest');
  });
});

describe('log', () => {
  it('writes level, message and meta', () => {
    log.info('pushed invoice', { billNo: 'T/2982/2026-27', action: 'created' });
    expect(lastLine()).toContain('INFO ');
    expect(lastLine()).toContain('pushed invoice');
    expect(lastLine()).toContain('"billNo":"T/2982/2026-27"');
  });

  it('omits the meta object entirely when there is nothing in it', () => {
    log.info('plain message');
    expect(lastLine()).toContain('plain message');
    expect(lastLine()).not.toContain('{}');
  });

  it('omits meta when the object is empty', () => {
    log.info('plain message', {});
    expect(lastLine()).not.toContain('{}');
  });

  it('ends every line with a newline, so entries never run together', () => {
    log.info('one');
    expect(lastLine().endsWith('\n')).toBe(true);
  });

  it('names the file by date, zero-padded', () => {
    log.info('anything');
    expect(lastPath()).toMatch(/tally-connector-\d{4}-\d{2}-\d{2}\.log$/);
  });

  it('creates the log directory rather than assuming it exists', () => {
    log.info('anything');
    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining('logs'), { recursive: true });
  });

  it('redacts secrets on the way to the file', () => {
    // Logs get pasted into chats and screenshots, so redaction happens here rather than relying on
    // every call site to remember.
    setLogSecrets(['change-me-please']);
    log.error('auth failed', { sentSecret: 'change-me-please' });
    expect(lastLine()).not.toContain('change-me-please');
    expect(lastLine()).toContain('***');
  });

  it('sends warnings and errors to their own console streams', () => {
    log.warn('careful');
    expect(console.warn).toHaveBeenCalled();
    log.error('broken');
    expect(console.error).toHaveBeenCalled();
  });

  it('does not throw when the log file cannot be written', () => {
    // An unwritable disk must never take the connector down.
    append.mockImplementationOnce(() => {
      throw new Error('EACCES');
    });
    expect(() => log.info('still fine')).not.toThrow();
    expect(console.log).toHaveBeenCalled();
  });

  it('still prints to the console when the directory cannot be created', () => {
    mkdir.mockImplementationOnce(() => {
      throw new Error('EPERM');
    });
    expect(() => log.info('console only')).not.toThrow();
    expect(console.log).toHaveBeenCalled();
  });
});
