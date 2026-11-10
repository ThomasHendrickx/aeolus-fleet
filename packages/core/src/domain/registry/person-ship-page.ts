/** Query-bound continuations use the verified identity and the database's last key. */
import { parsePersonShipCursor, personShipCursorOf, PERSON_SHIP_PAGE_SIZE, type PersonShipCursorRecord, type PersonShipPageInput, type ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { associatedShipIdOf, type PersonShipPageRow } from './person-ship-reads.js';

type Binding = Omit<PersonShipCursorRecord, 'after'>;

export interface PersonShipPagePosition {
  search: string;
  after?: PersonShipCursorRecord['after'];
  shipIds?: readonly ShipId[];
  binding: Binding;
}

function bindingOf(caller: Caller, page: { search: string; section: PersonShipCursorRecord['section'] }): Binding {
  const actor: PersonShipCursorRecord['actor'] = caller.kind === 'account' ? { kind: 'account', id: caller.accountId }
    : caller.kind === 'installation' ? { kind: 'installation' } : { kind: 'ship', id: caller.shipId };
  const associatedShipId = associatedShipIdOf(caller);
  return { version: 1, fleetId: caller.fleetId, section: page.section, actor, associatedShipId, search: page.search, order: 'folded-name-id-v1' };
}

function sameActor(first: Binding['actor'], second: Binding['actor']): boolean {
  return first.kind === second.kind && (first.kind === 'installation' || ('id' in first && 'id' in second && first.id === second.id));
}

export function personShipPagePosition(caller: Caller, read: { input: PersonShipPageInput; section: PersonShipCursorRecord['section'] }): Result<PersonShipPagePosition, DomainError<'INVALID_CURSOR'>> {
  const search = read.input.search?.trim() ?? '';
  const binding = bindingOf(caller, { section: read.section, search });
  const shipIds = 'shipIds' in read.input ? read.input.shipIds : undefined;
  if (shipIds !== undefined) {
    return ok({ search, shipIds: [...shipIds], binding });
  }
  const cursor = 'cursor' in read.input ? read.input.cursor : undefined;
  if (cursor === undefined || cursor === null) {
    return ok({ search, binding });
  }
  const parsed = parsePersonShipCursor(cursor);
  // The shared parser has already fixed the record and ordering versions.
  if (parsed?.fleetId !== binding.fleetId || parsed.section !== binding.section
    || !sameActor(parsed.actor, binding.actor) || parsed.associatedShipId !== binding.associatedShipId || parsed.search !== search) {
    return refuse('INVALID_CURSOR', 'The cursor does not match this ship read');
  }
  return ok({ search, after: parsed.after, binding });
}

export function personShipPageOf(position: PersonShipPagePosition, rows: readonly PersonShipPageRow[]): { selected: readonly PersonShipPageRow[]; nextCursor: string | null } {
  const selected = rows.slice(0, PERSON_SHIP_PAGE_SIZE);
  const last = selected.at(-1);
  const hasMore = position.shipIds === undefined && rows.length > PERSON_SHIP_PAGE_SIZE;
  return { selected, nextCursor: hasMore && last !== undefined ? personShipCursorOf({ ...position.binding, after: last.position }) : null };
}
