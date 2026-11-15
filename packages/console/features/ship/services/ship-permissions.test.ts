import { describe, expect, it } from 'vitest';

import { ARGO, CREWED_SHIP, RETIRED_SHIP } from '../../../lib/fixtures/ship-page.fixtures';
import { shipPermissionsOf } from './ship-permissions';

const actor = { kind: 'account' as const, scopes: ['scopes:grant', 'fleet:read'] };
const catalogue = [{ namespace: 'fleet', kind: 'core' as const, declaredBy: null, scopes: [{ scope: 'fleet:read', description: 'Read the fleet' }, { scope: 'fleet:manage', description: 'Manage ships' }] }];

describe('ship permissions within grant authority (0075)', () => {
  it('offers Change permissions only with the grant scope and confirmed manage reach', () => {
    // Given a live ship and an actor holding scopes:grant.
    const input = { ship: CREWED_SHIP, actor, catalogue };
    // When manage reach is pending, refused, or confirmed.
    const pending = shipPermissionsOf({ ...input, hasManageReach: undefined });
    const refused = shipPermissionsOf({ ...input, hasManageReach: false });
    const allowed = shipPermissionsOf({ ...input, hasManageReach: true });
    // Then only confirmed authority offers the editor, and the scope is also required.
    expect([pending.canChange, refused.canChange, allowed.canChange]).toEqual([false, false, true]);
    expect(shipPermissionsOf({ ...input, hasManageReach: true, actor: { ...actor, scopes: ['fleet:read'] } }).canChange).toBe(false);
  });

  it('never offers the editor for the actor’s own ship, fixed ships, or retired ships', () => {
    // Given full manage reach and the grant scope.
    const input = { actor, catalogue, hasManageReach: true };
    // When the target is its own ship, argo, the viewer, or retired.
    const views = [
      shipPermissionsOf({ ...input, ship: CREWED_SHIP, actor: { ...actor, shipId: CREWED_SHIP.id } }),
      shipPermissionsOf({ ...input, ship: { ...CREWED_SHIP, id: ARGO.id, kind: 'operator' } }),
      shipPermissionsOf({ ...input, ship: { ...CREWED_SHIP, kind: 'viewer' } }),
      shipPermissionsOf({ ...input, ship: RETIRED_SHIP }),
    ];
    // Then no editor is offered for any of them.
    expect(views.map((view) => view.canChange)).toEqual([false, false, false, false]);
  });

  it('keeps uncatalogued held permissions visible and locks base or ungrantable scopes', () => {
    // Given held scopes absent from the catalogue and an actor with only fleet:read.
    const ship = { ...CREWED_SHIP, scopes: [...CREWED_SHIP.scopes, 'crm:read-leads', 'fleet:read'] };
    // When the editor’s choices are built.
    const view = shipPermissionsOf({ ship, actor, catalogue, hasManageReach: true });
    // Then every held permission remains visible once, with only grantable extras unlocked.
    expect(view.choices).toEqual([
      { scope: 'fleet:read', description: 'Read the fleet', isLocked: false },
      { scope: 'fleet:manage', description: 'Manage ships', isLocked: true },
      { scope: 'messages:send', description: 'messages:send', isLocked: true },
      { scope: 'messages:receive', description: 'messages:receive', isLocked: true },
      { scope: 'crm:read-leads', description: 'crm:read-leads', isLocked: true },
    ]);
  });
});
