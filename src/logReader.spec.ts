import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readLog } from './logReader';
import { setLogSecrets } from './logger';

let dir: string;
const now = new Date(2026, 10, 6, 15, 30); // 2026-11-06 local

const write = (date: string, lines: string[]) =>
  fs.writeFileSync(path.join(dir, `tally-connector-${date}.log`), lines.join('\n') + '\n');

// Lines exactly as logger.ts writes them: ISO time, padded level, message, optional JSON meta.
const L = {
  started: '2026-11-04T06:20:00.000Z INFO  tally-connector started {"port":4000}',
  received: '2026-11-04T06:27:37.900Z INFO  push received {"billNo":"T/4806/2026-27","company":"PRATHAM TEST COMPANY","queued":0}',
  rejected:
    '2026-11-04T06:27:38.100Z ERROR Tally rejected the voucher {"billNo":"T/4806/2026-27","errorCode":"TALLY_LINEERROR","reason":"Could not set \'SVCurrentCompany\' to \'PRATHAM TEST COMPANY\'","took":"310ms"}',
  imported: '2026-11-04T06:30:01.000Z INFO  imported {"billNo":"T/4805/2026-27","action":"created","voucherId":"123","took":"420ms"}',
  creating: '2026-11-04T06:31:00.000Z INFO  creating missing ledger {"billNo":"T/4804/2026-27","ledger":"KILLICK NIXON LTD","round":1}',
  badPayload: '2026-11-04T06:32:00.000Z WARN  rejected before Tally {"billNo":"T/4803/2026-27","reason":"lines do not add up"}',
  pruned: '2026-11-04T06:20:00.000Z INFO  pruned old log files {"removed":[]}',
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'connector-logs-'));
  setLogSecrets([]);
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('readLog', () => {
  it('keeps only Tally outcomes — success, warning, error — and drops the rest', () => {
    write('2026-11-04', [L.started, L.pruned, L.received, L.rejected, L.imported, L.creating, L.badPayload]);
    const result = readLog({ date: '2026-11-04' }, { dir, now });
    expect(result.ok && result.entries.map((e) => [e.outcome, e.event])).toEqual([
      ['error', 'Tally rejected the voucher'],
      ['success', 'imported'],
      ['warning', 'creating missing ledger'],
      ['warning', 'rejected before Tally'],
    ]);
  });

  it("returns each entry structured, with Tally's reason verbatim", () => {
    write('2026-11-04', [L.rejected]);
    const result = readLog({ date: '2026-11-04' }, { dir, now });
    expect(result.ok && result.entries[0]).toEqual({
      at: '2026-11-04T06:27:38.100Z',
      outcome: 'error',
      event: 'Tally rejected the voucher',
      billNo: 'T/4806/2026-27',
      errorCode: 'TALLY_LINEERROR',
      reason: "Could not set 'SVCurrentCompany' to 'PRATHAM TEST COMPANY'",
      took: '310ms',
    });
  });

  it('counts each outcome for the whole day, before any filter or tail', () => {
    write('2026-11-04', [L.rejected, L.rejected, L.imported, L.badPayload, L.received]);
    const result = readLog({ date: '2026-11-04', tail: '1', outcome: 'success' }, { dir, now });
    expect(result.ok && result.counts).toEqual({ success: 1, warning: 1, error: 2 });
  });

  it('filters by outcome, | meaning any of', () => {
    write('2026-11-04', [L.rejected, L.imported, L.badPayload]);
    const errors = readLog({ date: '2026-11-04', outcome: 'error' }, { dir, now });
    expect(errors.ok && errors.entries.map((e) => e.event)).toEqual(['Tally rejected the voucher']);
    const notOk = readLog({ date: '2026-11-04', outcome: 'warning|error' }, { dir, now });
    expect(notOk.ok && notOk.returned).toBe(2);
  });

  it('refuses an outcome it does not know', () => {
    expect(readLog({ outcome: 'info' }, { dir, now })).toMatchObject({ ok: false, errorCode: 'BAD_QUERY' });
  });

  it('searches the raw line as plain text, ignoring case, | meaning any of', () => {
    write('2026-11-04', [L.rejected, L.imported, L.creating]);
    const one = readLog({ date: '2026-11-04', grep: 't/4806/2026-27' }, { dir, now });
    expect(one.ok && one.entries.map((e) => e.billNo)).toEqual(['T/4806/2026-27']);
    const two = readLog({ date: '2026-11-04', grep: 'SVCurrentCompany|KILLICK' }, { dir, now });
    expect(two.ok && two.returned).toBe(2);
  });

  it('matches regex characters literally', () => {
    write('2026-11-04', [L.rejected]);
    const result = readLog({ date: '2026-11-04', grep: "'SVCurrentCompany' to (" }, { dir, now });
    expect(result.ok && result.returned).toBe(0);
  });

  it('returns the last N entries, defaulting to the whole day up to 2000', () => {
    write('2026-11-06', Array.from({ length: 2100 }, (_, i) => L.imported.replace('T/4805', `T/${i}`)));
    const all = readLog({}, { dir, now });
    expect(all.ok && all.file).toBe('tally-connector-2026-11-06.log');
    expect(all.ok && all.returned).toBe(2000);
    expect(all.ok && all.entries[1999].billNo).toBe('T/2099/2026-27');
    const last = readLog({ tail: '2' }, { dir, now });
    expect(last.ok && last.entries.map((e) => e.billNo)).toEqual(['T/2098/2026-27', 'T/2099/2026-27']);
  });

  it('lists every day that has a log, so the other days can be opened', () => {
    write('2026-11-04', [L.imported]);
    write('2026-11-06', [L.imported]);
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a log');
    const result = readLog({}, { dir, now });
    expect(result.ok && result.days).toEqual(['2026-11-04', '2026-11-06']);
  });

  it.each([['../../.env'], ['2026-11-6'], ['2026/11/06'], ['2026-11-06.log']])(
    'refuses date %p so no other file can be read',
    (date) => {
      expect(readLog({ date }, { dir, now })).toMatchObject({ ok: false, errorCode: 'BAD_QUERY' });
    },
  );

  it.each([['0'], ['-5'], ['abc'], ['1.5']])('refuses tail %p', (tail) => {
    expect(readLog({ tail }, { dir, now })).toMatchObject({ ok: false, errorCode: 'BAD_QUERY' });
  });

  it('refuses a repeated or over-long grep', () => {
    expect(readLog({ grep: ['a', 'b'] }, { dir, now })).toMatchObject({ ok: false, errorCode: 'BAD_QUERY' });
    expect(readLog({ grep: 'x'.repeat(201) }, { dir, now })).toMatchObject({ ok: false, errorCode: 'BAD_QUERY' });
  });

  it('lists the days that do exist when the asked-for day has no file', () => {
    write('2026-11-03', [L.imported]);
    write('2026-11-04', [L.imported]);
    expect(readLog({ date: '2026-11-05' }, { dir, now })).toEqual({
      ok: false,
      errorCode: 'NOT_FOUND',
      error: 'No log for 2026-11-05',
      available: ['2026-11-03', '2026-11-04'],
    });
  });

  it('redacts registered secrets again on the way out', () => {
    // Lines written before a secret was registered would otherwise leave over HTTP verbatim.
    write('2026-11-04', [L.rejected.replace('Could not set', 'very-secret-value Could not set')]);
    setLogSecrets(['very-secret-value']);
    const result = readLog({ date: '2026-11-04' }, { dir, now });
    expect(result.ok && result.entries[0].reason).toBe("*** Could not set 'SVCurrentCompany' to 'PRATHAM TEST COMPANY'");
  });

  it('keeps a known event whose meta is not valid JSON, with the raw text', () => {
    write('2026-11-04', ['2026-11-04T06:40:00.000Z ERROR ledger list failed {broken']);
    const result = readLog({ date: '2026-11-04' }, { dir, now });
    expect(result.ok && result.entries[0]).toEqual({
      at: '2026-11-04T06:40:00.000Z',
      outcome: 'error',
      event: 'ledger list failed',
      raw: '{broken',
    });
  });
});
