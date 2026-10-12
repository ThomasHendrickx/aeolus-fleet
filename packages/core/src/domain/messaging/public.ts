// Messaging's published surface: what other contexts may use. Use cases are not
// part of it; adapters import them from their own modules.
export type { OverdueClock, WaitingState } from './overdue.js';
