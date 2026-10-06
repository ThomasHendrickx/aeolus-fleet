import { counted } from './sentence';

/**
 * The words of the ship-action dialogs that depend on a count or on what was
 * typed (docs/design/png/ReleaseDialog.png, RetireDialog.png, TypedConfirm.png).
 */

const DELIVERIES = { one: 'delivery', many: 'deliveries' };

/** Whether the typed text names the ship exactly: case and hyphens must match, nothing trimmed. */
export function isTypedMatch(expected: string, typed: string): boolean {
  return typed === expected;
}

/** What a release or a re-crew does to the deliveries the crew holds in flight. */
export function inFlightLine(inFlightCount: number): string {
  if (inFlightCount === 0) {
    return 'Nothing is in flight, so no delivery moves.';
  }
  const verb = inFlightCount === 1 ? 'returns' : 'return';
  return `${counted(inFlightCount, { one: 'in-flight delivery', many: 'in-flight deliveries' })} ${verb} to pending. Nothing is lost.`;
}

/** The retire button names action and consequence: "Retire ship", or "Retire and abandon 3 deliveries". */
export function retireButtonLabel(openDeliveries: number): string {
  return openDeliveries === 0 ? 'Retire ship' : `Retire and abandon ${counted(openDeliveries, DELIVERIES)}`;
}

/** The title of the retire warning: "3 deliveries will be abandoned". */
export function abandonedLine(openDeliveries: number): string {
  return `${counted(openDeliveries, DELIVERIES)} will be abandoned`;
}

/**
 * What a new crew line for a member ends, for the confirm that asks first;
 * none when it ends nothing (awaiting crew, no unclaimed line out).
 */
export function newCrewLineReplaced(ship: {
  status: string;
  location: { kind: string; description: string | null } | null;
  startingPrompt: { isClaimed: boolean } | null;
  inFlightDeliveries: number;
}): string | undefined {
  if (ship.status === 'crewed') {
    const where = ship.location === null ? 'the session crewing it' : `the session on ${ship.location.description ?? ship.location.kind.toLowerCase()}`;
    return `This ends ${where}. ${inFlightLine(ship.inFlightDeliveries)}`;
  }
  if (ship.startingPrompt !== null && !ship.startingPrompt.isClaimed) {
    return 'The crew line issued earlier, not claimed yet, stops working.';
  }
  return undefined;
}
