/**
 * Escapes the five XML entities. `&` must be replaced first, or the ampersands introduced by the
 * later replacements get escaped a second time.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Tally parses a plain decimal string. toFixed avoids both the grouping separators Intl would add
 * and the exponent notation String(n) produces for very small or very large numbers.
 */
export function formatAmount(n: number): string {
  return n.toFixed(2);
}
