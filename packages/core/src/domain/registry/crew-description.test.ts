import { describe, expect, it } from 'vitest';

import { crewDescription } from './crew-description.js';

describe('authorized crew description', () => {
  it.each([
    [null, null], ['', null], [' \n\t ', null],
    ['  Builds ships. More detail.', 'Builds ships.'],
    ['Ready? Yes!', 'Ready?'], ['Go!\nNow.', 'Go!'],
    ['Dr. Smith builds.', 'Dr.'], ['A.B works', 'A.B works'],
    ['first\nline ends. second', 'first\nline ends.'],
    ['  Καλημέρα 世界！  ', 'Καλημέρα 世界！'],
    ['100%_\\ literal', '100%_\\ literal'],
  ])('keeps the first sentence of %j including its punctuation', (summary, expected) => {
    // Given an absent or crew-supplied summary, without a commission fallback.
    const statement = summary === null ? null : { summary };

    // When the authorized description is projected.
    const description = crewDescription(statement);

    // Then only the approved first sentence is visible.
    expect(description).toBe(expected);
  });
});
