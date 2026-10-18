import { isPingContentType, type ShipId } from '@aeolus-fleet/common';
import { z } from 'zod';

import { templateReference } from '../catalogue/assemble-catalogue.js';
import type { FleetDoor, FleetRefusal, ManagementCrew, ReceivedMessage } from '../management/ports.js';
import { err, ok, type Result } from '../shared/result.js';
import type { FormSquadron } from './form-squadron.js';
import { FORM, FORM_REFUSED, FORM_SCOPE, FORMED } from './form-messages.js';
import type { FormRefusals, OperatorNotices, SquadronRepository } from './ports.js';
import type { Squadron } from './squadron.js';

/** What squadrons' ship did: formed a squadron, refused the request, answered a repeat of a key again, kept a message it does not handle, or answered argo's ping with pong. */
export type ManagementOutcome = 'formed' | 'refused' | 'repeated' | 'kept' | 'ponged';

export type HandleManagementDelivery = (crew: ManagementCrew, delivery: ReceivedMessage) => Promise<Result<ManagementOutcome, FleetRefusal>>;

const formPayload = z.object({
  blueprint: templateReference,
  squadronId: z.string().optional(),
  members: z.record(z.string(), z.object({ parameters: z.record(z.string(), z.string()).optional() })).optional(),
  key: z.string().min(1),
});

/** A refusal as the answer carries it. */
interface Refused {
  code: string;
  message: string;
}

/** The form request, parsed and checked; a refusal naming why when it is not one. */
function parsedRequest(payload: string): Result<z.infer<typeof formPayload>, Refused & { key: string | null }> {
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return err({ key: null, code: 'INVALID_FORM_REQUEST', message: 'The payload is no JSON: send { "blueprint": "<repository>#<name>@<n>", "key": "..." }' });
  }
  const parsed = formPayload.safeParse(json);
  if (parsed.success) {
    return ok(parsed.data);
  }
  const key = z.object({ key: z.string() }).safeParse(json).data?.key ?? null;
  const [issue] = parsed.error.issues;
  return err({ key, code: 'INVALID_FORM_REQUEST', message: `${issue?.path.join('.') ?? 'payload'}: ${issue?.message ?? 'is not valid'}` });
}

/** The squadron a forming ship formed under a key. */
function formedUnder(squadrons: readonly Squadron[], request: { formingShipId: ShipId; key: string }): Squadron | undefined {
  return squadrons.find((each) => each.formingShip?.shipId === request.formingShipId && each.formingShip.formKey === request.key);
}

/**
 * Use case: squadrons' own ship handles one delivery (decision 0017). A form
 * request (`squadron.form+json`) from a ship holding `squadrons:form`, read
 * from the fleet, never from the message, forms the squadron from the
 * blueprint for that ship, its forming ship: the sender as the fleet names
 * it. The answer, inReplyTo the request, is formed (the squadron id and its
 * flagship) or refused (a code and why); no crew line travels. squadrons
 * keeps its first answer per forming ship and key, and a repeat of the key
 * gets it again. Anything else is acknowledged and argo is told; a ping gets
 * pong. A delivery is acked only once it is answered, so one that comes again
 * finds its key.
 */
export function createHandleManagementDelivery(deps: {
  door: FleetDoor;
  squadrons: Pick<SquadronRepository, 'list'>;
  refusals: FormRefusals;
  form: FormSquadron;
  operator: OperatorNotices;
}): HandleManagementDelivery {
  return async (crew, delivery) => {
    const { crewToken, fleetId } = crew;
    const acked = async (outcome: ManagementOutcome): Promise<Result<ManagementOutcome, FleetRefusal>> => {
      const ack = await deps.door.ack(crewToken, delivery.deliveryId);
      return ack.isOk ? ok(outcome) : err(ack.error);
    };
    const answer = async (outcome: ManagementOutcome, reply: { contentType: string; payload: unknown }): Promise<Result<ManagementOutcome, FleetRefusal>> => {
      const sent = await deps.door.send(crewToken, {
        selector: { kind: 'ship', shipId: delivery.senderShipId },
        contentType: reply.contentType,
        inReplyTo: delivery.messageId,
        idempotencyKey: `form-answer-${delivery.deliveryId}`,
        payload: JSON.stringify(reply.payload),
      });
      return sent.isOk ? acked(outcome) : err(sent.error);
    };
    const formed = (outcome: ManagementOutcome, squadron: { key: string; squadronId: string; flagship: string }) => answer(outcome, { contentType: FORMED, payload: squadron });
    const refused = (outcome: ManagementOutcome, refusal: Refused & { key: string | null }) => answer(outcome, { contentType: FORM_REFUSED, payload: refusal });

    if (isPingContentType(delivery.contentType)) {
      const ponged = await deps.door.pong(crewToken, delivery.deliveryId);
      return ponged.isOk ? ok('ponged') : err(ponged.error);
    }
    if (delivery.contentType !== FORM) {
      await deps.operator.tell({
        fleetId,
        headline: `${delivery.senderName} sent squadrons a message it does not handle`,
        body: `- From: ${delivery.senderName}\n- Content type: \`${delivery.contentType}\`\n\nsquadrons' ship takes only form requests (\`${FORM}\`); nothing was done.`,
        key: `management-kept-${delivery.deliveryId}`,
      });
      return acked('kept');
    }

    const request = parsedRequest(delivery.payload);
    if (!request.isOk) {
      return refused('refused', request.error);
    }
    const { key } = request.value;
    const earlier = formedUnder(await deps.squadrons.list(fleetId), { formingShipId: delivery.senderShipId, key });
    if (earlier) {
      return formed('repeated', { key, squadronId: earlier.id, flagship: earlier.flagship.name });
    }
    const earlierRefusal = await deps.refusals.find(fleetId, { formingShipId: delivery.senderShipId, key });
    if (earlierRefusal) {
      return refused('repeated', { key, code: earlierRefusal.code, message: earlierRefusal.message });
    }

    const keepRefusal = async (refusal: Refused): Promise<Result<ManagementOutcome, FleetRefusal>> => {
      await deps.refusals.keep({ fleetId, formingShipId: delivery.senderShipId, key, ...refusal });
      return refused('refused', { key, ...refusal });
    };
    const sender = await deps.door.getShip(crewToken, { shipId: delivery.senderShipId });
    if (!sender.isOk) {
      return err(sender.error);
    }
    if (!sender.value.scopes.includes(FORM_SCOPE)) {
      return keepRefusal({ code: 'NEEDS_SCOPE', message: `Forming a squadron needs ${FORM_SCOPE}, which ${delivery.senderName} does not hold` });
    }
    const { blueprint, squadronId, members } = request.value;
    const made = await deps.form({
      fleetId,
      blueprint,
      ...(squadronId === undefined ? {} : { squadronId }),
      ...(members === undefined ? {} : { members }),
      formingShip: { shipId: delivery.senderShipId, name: delivery.senderName, formKey: key },
    });
    if (!made.isOk) {
      return keepRefusal({ code: made.error.kind, message: made.error.message });
    }
    return formed('formed', { key, squadronId: made.value.squadronId, flagship: made.value.flagship.name });
  };
}
