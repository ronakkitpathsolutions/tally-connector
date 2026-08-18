/**
 * Educational-mode date handling.
 *
 * TallyPrime's free Educational version only accepts voucher dates on the 1st, 2nd, or last day of
 * a month; anything else fails the entry. Without this, testing against Educational Tally produces
 * rejections that look like XML problems but are really date-policy problems — which is exactly the
 * confusion this whole module exists to prevent.
 *
 * This is a TESTING aid, enabled only by TALLY_EDU_MODE. It must never run against a licensed Tally.
 */

const YYYYMMDD = /^(\d{4})(\d{2})(\d{2})$/;

/** `month` is 1-based. Day 0 of the next month is the last day of this one. */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function normalizeEduDate(date: string): string {
  const match = YYYYMMDD.exec(date);
  // Never invent a date: a malformed value passes through so Tally reports it, rather than being
  // quietly replaced with one that happens to parse.
  if (!match) return date;

  const [, yyyy, mm, dd] = match;
  const day = Number(dd);
  if (day === 1 || day === 2) return date;

  const last = lastDayOfMonth(Number(yyyy), Number(mm));
  return `${yyyy}${mm}${String(last).padStart(2, '0')}`;
}
