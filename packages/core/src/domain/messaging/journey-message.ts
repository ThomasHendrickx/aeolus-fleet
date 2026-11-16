/** Qualification uses envelope metadata and actual crew facts, never work content. */
import { isPingContentType, type ShipId, type ShipKind } from '@aeolus-fleet/common';

import { isCustomerShip } from '../shared/fleet-journey.js';

export interface JourneyParty { id: ShipId; kind: ShipKind; isCrewed: boolean }

export function qualifyJourneyMessage(input: { sender: JourneyParty; recipient: JourneyParty; contentType: string; isSystem: boolean; isReturnToSender: boolean }) {
  const isQualifying = !input.isSystem && !isPingContentType(input.contentType)
    && input.sender.id !== input.recipient.id && isCustomerShip(input.sender.kind) && isCustomerShip(input.recipient.kind);
  const isCrewedAtBothEnds = isQualifying && input.sender.isCrewed && input.recipient.isCrewed;
  return { isQualifying, isCrewedAtBothEnds, isRoundTrip: isCrewedAtBothEnds && input.isReturnToSender };
}
