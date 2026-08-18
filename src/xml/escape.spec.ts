import { escapeXml, formatAmount } from './escape';

describe('escapeXml', () => {
  it('escapes the five XML entities', () => {
    expect(escapeXml('A & B')).toBe('A &amp; B');
    expect(escapeXml('<x>')).toBe('&lt;x&gt;');
    expect(escapeXml(`He said "hi" it's fine`)).toBe('He said &quot;hi&quot; it&apos;s fine');
  });

  it('escapes ampersands in real party names', () => {
    // A routine cause of Tally import failure.
    expect(escapeXml('R & B LOGISTICS PVT LTD')).toBe('R &amp; B LOGISTICS PVT LTD');
  });

  it('does not double-escape the entities it just introduced', () => {
    expect(escapeXml('a & <b>')).toBe('a &amp; &lt;b&gt;');
    expect(escapeXml('&amp;')).toBe('&amp;amp;');
  });
});

describe('formatAmount', () => {
  it('always renders exactly two decimals', () => {
    expect(formatAmount(83200)).toBe('83200.00');
    expect(formatAmount(-98176)).toBe('-98176.00');
    expect(formatAmount(14976.5)).toBe('14976.50');
  });

  it('uses no thousands separators and no exponent notation', () => {
    expect(formatAmount(1234567.891)).toBe('1234567.89');
    expect(formatAmount(0.0000001)).toBe('0.00');
  });
});
