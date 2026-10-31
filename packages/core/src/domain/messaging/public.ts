// Messaging's published surface: what other contexts may use. Use cases are not
// part of it; adapters import them from their own modules.
export { hasClockRunOut, NOT_CONFIRMED_MINUTES, type ClockedCrew, type OverdueClock, type WaitingState } from './overdue.js';
export { leaveMeetingsOnRetire, lockMeetingsOf, type RetiredParticipantTx } from './retired-participant.js';
export { cancelSchedulesOnRetire, lockSchedulesOf, type RetiredSchedulerTx } from './retired-scheduler.js';
export type { FleetSealingRepository, RequestHasher } from './ports.js';
export type { CompanyKeyUnavailableReason } from './fleet-sealing.js';
export type { AcceptRefusal } from './message.js';
export {
  DATA_KEY_CACHE_MS,
  heldForList,
  heldForRead,
  listedUnsealed,
  plainForRead,
  withDataKeys,
  type DataKeysNeeded,
  type HeldDataKeys,
  type ListedPayload,
  type PayloadSealing,
  type UnreadablePayload,
  UNREADABLE_PAYLOAD,
} from './data-keys.js';
export { isSealedPayload, type StoredPayload } from './sealed-payload.js';
