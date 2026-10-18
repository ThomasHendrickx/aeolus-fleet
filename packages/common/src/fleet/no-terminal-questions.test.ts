import { describe, expect, it } from 'vitest';

import { NO_TERMINAL_QUESTIONS } from './no-terminal-questions.js';

describe('the line every crewed session is told', () => {
  it("says no human reads its terminal, to ask over the fleet, and to ask its ship's owner what only a human can answer, on one line (#585, decision 0045)", () => {
    expect(NO_TERMINAL_QUESTIONS).toBe("No human reads this terminal. Never ask here; ask over the fleet. A question only a human can answer goes to your ship's owner (argo when argo owns your ship).");
  });
});
