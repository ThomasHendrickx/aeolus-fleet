/**
 * A ship's name and its type are handles (docs/blueprint.md, "Ship"). A colon
 * is an ordinary character, so a prefix can group ships (`hemma:planner`); it
 * carries no meaning for the fleet.
 */
export const SHIP_HANDLE_MAX_LENGTH = 48;
export const SHIP_HANDLE_PATTERN = /^[a-z0-9:-]+$/;
export const SHIP_HANDLE_MESSAGE = `Use 1 to ${String(SHIP_HANDLE_MAX_LENGTH)} lowercase letters, digits, hyphens or colons`;

/** Whether a text is a ship handle: 1 to 48 lowercase letters, digits, hyphens or colons. */
export function isShipHandle(text: string): boolean {
  return text.length <= SHIP_HANDLE_MAX_LENGTH && SHIP_HANDLE_PATTERN.test(text);
}
