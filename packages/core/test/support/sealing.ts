/**
 * Payload sealing for the tests of a fleet that is not sealed (decision
 * 0068): such a fleet never needs a data key, so asking for one fails the
 * test.
 */
import type { PayloadSealing } from '../../src/domain/messaging/data-keys.js';
import { inMemoryPayloadSealer } from './in-memory-payload-sealer.js';

export const unsealedFleetsOnly: PayloadSealing = {
  sealer: inMemoryPayloadSealer,
  dataKeys: { unwrap: () => Promise.reject(new Error('This test seals no fleet, so it unwraps no data key')) },
};
