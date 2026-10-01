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
