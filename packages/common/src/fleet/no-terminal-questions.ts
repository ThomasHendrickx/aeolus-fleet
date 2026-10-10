/**
 * The line every crewed session is told (#585): nobody watches its pane, so a
 * question asked there waits for ever. The ship protocol states it, the
 * trierarch adds it to its first and every wake prompt, and the aeolus
 * plugin's crew skills say the same.
 */
export const NO_TERMINAL_QUESTIONS = 'No human reads this terminal. Never ask here; ask over the fleet. A question only the operator can answer goes to argo.';
