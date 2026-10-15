/**
 * How an overview filter that picks several values (#815) reads in its
 * Select: All is checked while nothing is picked and clears what is picked
 * when chosen; the trigger names one value picked and counts several.
 */

/** The Select item that stands for nothing picked. */
export const ALL = 'all';

/** What the Select shows checked: All while nothing is picked, else the values picked. */
export function shownPicks(picked: readonly string[]): string[] {
  return picked.length === 0 ? [ALL] : [...picked];
}

/**
 * The values picked after the Select changed from `shownPicks(previous)` to
 * `next`: All chosen picks nothing; any other change keeps the values, All left out.
 */
export function pickedAfter(previous: readonly string[], next: readonly string[]): string[] {
  const isAllChosen = previous.length > 0 && next.includes(ALL);
  return isAllChosen ? [] : next.filter((value) => value !== ALL);
}

export type PickedSummary = { kind: 'all' } | { kind: 'one'; word: string } | { kind: 'several'; count: number };

/** What the trigger shows: All, the one value picked by its word (or itself without one), or how many are picked. */
export function pickedSummary(picked: readonly string[], words: Readonly<Record<string, string>>): PickedSummary {
  const [first] = picked;
  if (first === undefined) {
    return { kind: 'all' };
  }
  return picked.length === 1 ? { kind: 'one', word: words[first] ?? first } : { kind: 'several', count: picked.length };
}
