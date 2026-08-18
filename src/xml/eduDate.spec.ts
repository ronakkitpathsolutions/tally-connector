import { lastDayOfMonth, normalizeEduDate } from './eduDate';

describe('lastDayOfMonth', () => {
  it('knows the length of ordinary months', () => {
    expect(lastDayOfMonth(2026, 8)).toBe(31); // August
    expect(lastDayOfMonth(2026, 4)).toBe(30); // April
  });

  it('handles February in common and leap years', () => {
    expect(lastDayOfMonth(2026, 2)).toBe(28);
    expect(lastDayOfMonth(2024, 2)).toBe(29);
    // Century rule: 1900 was not a leap year, 2000 was.
    expect(lastDayOfMonth(1900, 2)).toBe(28);
    expect(lastDayOfMonth(2000, 2)).toBe(29);
  });
});

describe('normalizeEduDate', () => {
  it('leaves the 1st and 2nd untouched — educational Tally accepts them', () => {
    expect(normalizeEduDate('20260801')).toBe('20260801');
    expect(normalizeEduDate('20260802')).toBe('20260802');
  });

  it('moves any other day to the last day of the same month', () => {
    expect(normalizeEduDate('20260805')).toBe('20260831');
    expect(normalizeEduDate('20260722')).toBe('20260731');
    expect(normalizeEduDate('20260415')).toBe('20260430');
  });

  it('stays inside the month it was given', () => {
    // The financial period must not shift; only the day moves.
    expect(normalizeEduDate('20260215')).toBe('20260228');
    expect(normalizeEduDate('20240215')).toBe('20240229');
  });

  it('is idempotent — normalizing twice changes nothing further', () => {
    const once = normalizeEduDate('20260805');
    expect(normalizeEduDate(once)).toBe(once);
  });

  it('passes through anything that is not a YYYYMMDD string', () => {
    // Never invent a date. A malformed value should surface as Tally's own error, not be masked.
    expect(normalizeEduDate('')).toBe('');
    expect(normalizeEduDate('2026-08-05')).toBe('2026-08-05');
    expect(normalizeEduDate('not a date')).toBe('not a date');
  });
});
