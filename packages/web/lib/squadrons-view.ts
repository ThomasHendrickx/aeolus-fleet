import type { BlueprintVersion, Catalogue, Squadron, TemplateVersion } from './squadrons-api';

/** A ship's place in a squadron: a member with its role, or the flagship (role null). */
export interface ShipInSquadron {
  squadronId: string;
  role: string | null;
}

/** A blueprint with its versions, newest first: the first is the latest. */
export interface BlueprintChoice {
  key: string;
  repository: string;
  name: string;
  versions: BlueprintVersion[];
}

/** The catalogue's blueprints by repository and name, each with its versions newest first, in name order. */
export function blueprintChoices(catalogue: Pick<Catalogue, 'blueprints'>): BlueprintChoice[] {
  const byKey = new Map<string, BlueprintChoice>();
  for (const blueprint of catalogue.blueprints) {
    const key = `${blueprint.repository}#${blueprint.name}`;
    const choice = byKey.get(key) ?? {
      key,
      repository: blueprint.repository,
      name: blueprint.name,
      versions: [],
    };
    choice.versions.push(blueprint);
    byKey.set(key, choice);
  }
  return [...byKey.values()]
    .map((choice) => ({
      ...choice,
      versions: [...choice.versions].sort((first, second) => second.version - first.version),
    }))
    .sort((first, second) => first.name.localeCompare(second.name));
}

/** One role as forming commissions it: its template version, how many members and how often they check in. */
export interface RolePreview {
  role: string;
  template: string;
  count: number;
  checkInMinutes: number | undefined;
}

export function rolePreviews(blueprint: BlueprintVersion, templates: readonly TemplateVersion[]): RolePreview[] {
  return blueprint.roles.map((role) => ({
    role: role.name,
    template: `${role.template.name}@${String(role.template.version)}`,
    count: role.count,
    checkInMinutes: templates.find(
      (template) => template.repository === role.template.repository && template.name === role.template.name && template.version === role.template.version,
    )?.checkInMinutes,
  }));
}

/** How many ships forming commissions: every member, and the flagship. */
export function memberCount(blueprint: BlueprintVersion): number {
  return blueprint.roles.reduce((total, role) => total + role.count, 0);
}

const MINUTES_PER_HOUR = 60;

/** A check-in interval as the console says it: "every 30 min", "every 2 h". */
export function checkInText(minutes: number): string {
  return minutes % MINUTES_PER_HOUR === 0 ? `every ${String(minutes / MINUTES_PER_HOUR)} h` : `every ${String(minutes)} min`;
}

/** How many members are on station, of how many. */
export function stationCount(squadron: Pick<Squadron, 'members'>): {
  onStation: number;
  total: number;
} {
  return {
    onStation: squadron.members.filter((member) => member.onStationAt !== null).length,
    total: squadron.members.length,
  };
}

/** The members, grouped by role in the order the roles first appear. */
export function membersByRole<M extends { role: string }>(members: readonly M[]): { role: string; members: M[] }[] {
  const groups = new Map<string, M[]>();
  for (const member of members) {
    groups.set(member.role, [...(groups.get(member.role) ?? []), member]);
  }
  return [...groups.entries()].map(([role, grouped]) => ({
    role,
    members: grouped,
  }));
}

/** Which squadron each ship belongs to, by ship id: its flagship and its members. Disbanded squadrons hold no ships. */
export function shipsInSquadrons(squadrons: readonly Pick<Squadron, 'id' | 'state' | 'flagship' | 'members'>[]): ReadonlyMap<string, ShipInSquadron> {
  const byShip = new Map<string, ShipInSquadron>();
  for (const squadron of squadrons) {
    if (squadron.state === 'disbanded') {
      continue;
    }
    byShip.set(squadron.flagship.shipId, { squadronId: squadron.id, role: null });
    for (const member of squadron.members) {
      byShip.set(member.shipId, { squadronId: squadron.id, role: member.role });
    }
  }
  return byShip;
}
