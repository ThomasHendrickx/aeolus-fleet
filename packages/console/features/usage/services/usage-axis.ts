/** The steps a value axis may top out at, as multiples of a power of ten. */
const NICE_STEPS = [1, 2, 2.5, 5, 10];
const FIRST_STEP = 1;

/** The round number the value axis tops out at, just above the tallest column: 3.4 M tops out at 5 M. 0 tops out at 1. */
export function niceMaxOf(tallest: number): number {
  if (tallest <= 0) {
    return FIRST_STEP;
  }
  const power = 10 ** Math.floor(Math.log10(tallest));
  const step = NICE_STEPS.find((candidate) => tallest / power <= candidate) ?? NICE_STEPS[NICE_STEPS.length - 1] ?? FIRST_STEP;
  return step * power;
}
