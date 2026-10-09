import { isShipHandle, SHIP_HANDLE_MAX_LENGTH } from '@aeolus-fleet/common/rules';

import { OPERATOR_NAME } from './sentence';

/**
 * A ship name as the operator types it (docs/design/png/CommissionForm.png,
 * RenameDialog.png): the rule while empty, then available or why not, checked
 * against the active ships the console knows. The server checks again under
 * its name lock; this only says early.
 */
export type NameCheck =
  | { kind: 'empty'; message: string }
  | { kind: 'available'; message: string }
  | { kind: 'unchanged'; message: string }
  | { kind: 'invalid' | 'reserved' | 'taken'; message: string };

export const NAME_RULE = `Lowercase letters, digits, hyphens and colons, up to ${String(SHIP_HANDLE_MAX_LENGTH)} characters, unique among active ships.`;

/**
 * A name or type as the console's fields take it: typed uppercase becomes
 * lowercase, so HemmaFeature reads hemmafeature. Only the console eases this;
 * the API rule stays strict and refuses uppercase.
 */
export function asHandle(typed: string): string {
  return typed.toLowerCase();
}

export function checkShipName(name: string, fleet: { activeNames: readonly string[]; current?: string }): NameCheck {
  if (name === '') {
    return { kind: 'empty', message: NAME_RULE };
  }
  if (!isShipHandle(name)) {
    return { kind: 'invalid', message: `Use 1 to ${String(SHIP_HANDLE_MAX_LENGTH)} lowercase letters, digits, hyphens or colons.` };
  }
  if (name === OPERATOR_NAME) {
    return { kind: 'reserved', message: `${OPERATOR_NAME} is reserved for the operator ship.` };
  }
  if (name === fleet.current) {
    return { kind: 'unchanged', message: 'That is its name now.' };
  }
  if (fleet.activeNames.includes(name)) {
    return { kind: 'taken', message: `${name} is already used by an active ship.` };
  }
  return { kind: 'available', message: `${name} is available.` };
}

/** What the typed type means for the fleet (docs/design/png/CommissionForm.png): a new type, or how many ships use it. */
export function typeHint(type: string, shipsOfType: number): string {
  const trimmed = type.trim();
  if (trimmed === '') {
    return 'Free text. Pick a type in use or write a new one.';
  }
  if (shipsOfType === 0) {
    return `No ship uses this type yet. ${trimmed} becomes a new type.`;
  }
  return shipsOfType === 1 ? '1 ship uses this type.' : `${String(shipsOfType)} ships use this type.`;
}
