// Messaging's published surface: what other contexts may use. Use cases are not
// part of it; adapters import them from their own modules.
export { hasClockRunOut, NOT_CONFIRMED_MINUTES, type ClockedCrew, type OverdueClock, type WaitingState } from './overdue.js';
export { leaveMeetingsOnRetire, lockMeetingsOf, type RetiredParticipantTx } from './retired-participant.js';
export type { RequestHasher } from './ports.js';
export type { AcceptRefusal } from './message.js';
