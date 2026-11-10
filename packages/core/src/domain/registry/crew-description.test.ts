import { describe, expect, it } from 'vitest';

import { CREW_DESCRIPTION_FIXTURES } from '../../../test/support/crew-description-fixtures.js';
import { crewDescription } from './crew-description.js';

describe('authorized crew description', () => {
  it.each(CREW_DESCRIPTION_FIXTURES)('keeps the first sentence of %j including its punctuation', (summary, expected) => {
    // Given an absent or crew-supplied summary, without a commission fallback.
    const statement = summary === null ? null : { summary };

    // When the authorized description is projected.
    const description = crewDescription(statement);

    // Then only the approved first sentence is visible.
    expect(description).toBe(expected);
  });
});
