/**
 * Characters XML 1.0 forbids outright — escaping cannot save them. A stray one (a vertical tab or
 * form feed pasted from Excel into a narration or address) makes Tally reject the whole request,
 * and only for the one bill that carried it, so it reads as a random failure.
 */
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/**
 * Escapes the five XML entities. `&` must be replaced first, or the ampersands introduced by the
 * later replacements get escaped a second time.
 */
export function escapeXml(value: string): string {
  return value
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * An amount in whole paise, rounded half away from zero.
 *
 * Not `Math.round(n * 100)`: 1.005 * 100 is 100.49999999999999 in binary floating point, so that
 * rounds down where an accountant rounds up. The epsilon absorbs that representation error.
 */
export function toPaise(n: number): number {
  const paise = Math.round(Math.abs(n) * 100 + 1e-7);
  return n < 0 ? -paise : paise;
}

/**
 * Tally parses a plain decimal string. Rounded through toPaise so the figure written is exactly the
 * figure the balance checks added up — toFixed alone rounds 1.005 to "1.00".
 */
export function formatAmount(n: number): string {
  const paise = toPaise(n);
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
