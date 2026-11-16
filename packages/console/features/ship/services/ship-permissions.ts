import type { ShipDetail, ShipId } from '@aeolus-fleet/common';

interface Actor {
  kind: 'operator' | 'viewer' | 'account';
  scopes: readonly string[];
  /** Accounts grant as themselves; only a ship actor has its own ship. */
  shipId?: ShipId;
}
interface Namespace {
  kind: 'core' | 'plugin' | 'fleet';
  declaredBy: { id: ShipId } | null;
  scopes: readonly { scope: string; description: string }[];
}

/** Grant authority and choices for the inline editor (0075); live fleet checks remain authoritative. */
export function shipPermissionsOf({ ship, actor, catalogue, hasManageReach }: {
  ship: Pick<ShipDetail, 'id' | 'status' | 'kind' | 'scopes'>;
  actor: Actor | undefined;
  catalogue: readonly Namespace[] | undefined;
  hasManageReach: boolean | undefined;
}) {
  const canChange = actor?.scopes.includes('scopes:grant') === true && hasManageReach === true && ship.id !== actor.shipId && ship.status !== 'retired' && ship.kind !== 'operator' && ship.kind !== 'viewer';
  const described = catalogue?.flatMap((namespace) => namespace.scopes.map((choice) => ({
    ...choice,
    isLocked: choice.scope === 'messages:send' || choice.scope === 'messages:receive' || !(actor?.kind === 'operator' || actor?.scopes.includes(choice.scope) === true || (actor?.shipId !== undefined && namespace.kind === 'plugin' && namespace.declaredBy?.id === actor.shipId)),
  })));
  const choices = described === undefined ? undefined : [...described, ...ship.scopes.filter((scope) => !described.some((choice) => choice.scope === scope)).map((scope) => ({ scope, description: scope, isLocked: true }))];
  return { canChange, choices };
}
