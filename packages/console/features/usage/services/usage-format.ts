/** How the Usage page writes its numbers: short in the chart, the legend and the totals. */

const THOUSAND = 1e3;
const MILLION = 1e6;
const BILLION = 1e9;
const DOLLARS_WITHOUT_CENTS = 100;

/** Tokens in short words: 950, 12 k, 1.2 M, 3.4 B. */
export function tokensWords(tokens: number): string {
  if (tokens >= BILLION) {
    return `${(tokens / BILLION).toFixed(1)} B`;
  }
  if (tokens >= MILLION) {
    return `${(tokens / MILLION).toFixed(1)} M`;
  }
  if (tokens >= THOUSAND) {
    return `${(tokens / THOUSAND).toFixed(0)} k`;
  }
  return String(Math.round(tokens));
}

/** Dollars in short words: $4.50, $128, $2.5k. */
export function usdWords(usd: number): string {
  if (usd >= THOUSAND) {
    return `$${(usd / THOUSAND).toFixed(1)}k`;
  }
  return `$${usd >= DOLLARS_WITHOUT_CENTS ? usd.toFixed(0) : usd.toFixed(2)}`;
}
