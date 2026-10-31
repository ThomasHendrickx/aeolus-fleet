import type { UsageMeasure, UsageSplit } from './usage-state';
import type { UsageGrain } from './usage-window';

/**
 * The notes under the chart (docs/design/usage/mockup): what a column is, what
 * the numbers mean, said once each, and only the ones that apply.
 */
export function usageNotesOf(input: { grain: UsageGrain; measure: UsageMeasure; splitBy: UsageSplit; hasOther: boolean }): string[] {
  const { grain, measure, splitBy, hasOther } = input;
  return [
    grain === 'hour' ? 'One column per hour, in your time zone. An hour shows once it ends.' : 'One column per day, days in UTC.',
    measure === 'cost'
      ? "Estimated cost is each trierarch's list-price estimate at the time; on a subscription it is not what is paid. Models it does not price count nothing here."
      : 'Tokens add up input, output, cache read and cache write; split by token kind to see each.',
    ...(splitBy === 'login' ? ['"Not reported": hours from before the trierarch reported a login.'] : []),
    ...(hasOther ? ['The 7 largest in the range, the rest as Other.'] : []),
  ];
}
