import type { ReportState } from '@aeolus-fleet/common';

import type { BlueprintVersion, Catalogue, MemberHealth, Squadron, TemplateVersion } from './squadrons-api';

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

/** Where a blueprint's page is: its name, with its repository and version in the query. */
export function blueprintPath(blueprint: { repository: string; name: string; version?: number }): string {
  const query = new URLSearchParams({ repository: blueprint.repository });
  if (blueprint.version !== undefined) {
    query.set('version', String(blueprint.version));
  }
  return `/squadrons/blueprints/${encodeURIComponent(blueprint.name)}?${query.toString()}`;
}

/** The squadrons formed from a blueprint, any version, oldest first as listed. */
export function squadronsFromBlueprint<S extends Pick<Squadron, 'blueprint'>>(squadrons: readonly S[], blueprint: { repository: string; name: string }): S[] {
  return squadrons.filter((squadron) => squadron.blueprint.repository === blueprint.repository && squadron.blueprint.name === blueprint.name);
}

/** How many members have each health, in the order the summary says them; healths no member has are left out. */
export function healthCounts(members: readonly { health: MemberHealth }[]): { health: MemberHealth; count: number }[] {
  const order: MemberHealth[] = ['on-time', 'late', 'silent', 'standing-down', 'not-on-station'];
  return order.map((health) => ({ health, count: members.filter((member) => member.health === health).length })).filter((each) => each.count > 0);
}

/** The silent members of every squadron not disbanded: they go to Needs attention. */
export function silentMembers<M extends { health: MemberHealth }>(
  squadrons: readonly { id: string; state: Squadron['state']; members: readonly M[] }[],
): { squadronId: string; member: M }[] {
  return squadrons
    .filter((squadron) => squadron.state !== 'disbanded')
    .flatMap((squadron) => squadron.members.filter((member) => member.health === 'silent').map((member) => ({ squadronId: squadron.id, member })));
}

/** A role a member can be added to: its template version, interval, and how many members it has now and in the blueprint. */
export interface RoleOption {
  role: string;
  template: string;
  checkInMinutes: number | undefined;
  /** Members of the role in the squadron now, retired ones left out. */
  now: number;
  /** Members of the role the blueprint forms. */
  inBlueprint: number;
}

export function roleOptions(
  squadron: { members: readonly { role: string; crew: { status: string } }[] },
  formedFrom: { blueprint: BlueprintVersion; templates: readonly TemplateVersion[] },
): RoleOption[] {
  const { blueprint, templates } = formedFrom;
  return rolePreviews(blueprint, templates).map((role) => ({
    role: role.role,
    template: role.template,
    checkInMinutes: role.checkInMinutes,
    now: squadron.members.filter((member) => member.role === role.role && member.crew.status !== 'retired').length,
    inBlueprint: role.count,
  }));
}

/** The members of the removed member's role that stay: none means it is the last of its role. */
export function otherMembersOfRole(squadron: { members: readonly { shipId: string; name: string; role: string; crew: { status: string } }[] }, shipId: string): string[] {
  const role = squadron.members.find((member) => member.shipId === shipId)?.role;
  return squadron.members.filter((member) => member.role === role && member.shipId !== shipId && member.crew.status !== 'retired').map((member) => member.name);
}

/** A template with its versions, newest first: the first is the latest. */
export interface TemplateChoice {
  key: string;
  repository: string;
  name: string;
  versions: TemplateVersion[];
}

/** Every template in the catalogue with its versions, newest first, by name. */
export function templateChoices(catalogue: Pick<Catalogue, 'templates'>): TemplateChoice[] {
  const byKey = new Map<string, TemplateChoice>();
  for (const template of catalogue.templates) {
    const key = `${template.repository}#${template.name}`;
    const choice = byKey.get(key) ?? { key, repository: template.repository, name: template.name, versions: [] };
    choice.versions.push(template);
    byKey.set(key, choice);
  }
  return [...byKey.values()]
    .map((choice) => ({ ...choice, versions: [...choice.versions].sort((first, second) => second.version - first.version) }))
    .sort((first, second) => first.name.localeCompare(second.name));
}

/** Where a template's page is: its name, with its repository and version in the query. */
export function templatePath(template: { repository: string; name: string; version?: number }): string {
  const query = new URLSearchParams({ repository: template.repository });
  if (template.version !== undefined) {
    query.set('version', String(template.version));
  }
  return `/squadrons/templates/${encodeURIComponent(template.name)}?${query.toString()}`;
}

/** The blueprint versions with a role that runs the template: any of its versions, or the one given. */
export function blueprintsUsing(blueprints: readonly BlueprintVersion[], template: { repository: string; name: string; version?: number }): BlueprintVersion[] {
  return blueprints.filter((blueprint) =>
    blueprint.roles.some(
      (role) =>
        role.template.repository === template.repository &&
        role.template.name === template.name &&
        (template.version === undefined || role.template.version === template.version),
    ),
  );
}

/** A blueprint's roles as the Blueprints tab says them: "planner, implementer ×2, tester". */
export function rolesText(blueprint: Pick<BlueprintVersion, 'roles'>): string {
  return blueprint.roles.map((role) => (role.count > 1 ? `${role.name} ×${String(role.count)}` : role.name)).join(', ');
}

/** The squadrons not disbanded, by state, as the Blueprints tab says them: "1 sailing, 1 forming"; empty for none. */
export function squadronsText(squadrons: readonly Pick<Squadron, 'state'>[]): string {
  const order: Squadron['state'][] = ['forming', 'sailing', 'standing-down'];
  return order
    .map((state) => ({ state, count: squadrons.filter((squadron) => squadron.state === state).length }))
    .filter((each) => each.count > 0)
    .map((each) => `${String(each.count)} ${each.state.replace('-', ' ')}`)
    .join(', ');
}

function spanText(minutes: number): string {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  if (hours === 0) {
    return `${String(rest)} min`;
  }
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/** Missed check-ins before a member is late, and before it is silent (docs/squadrons.md). */
const LATE_AFTER_INTERVALS = 1;
const SILENT_AFTER_INTERVALS = 3;

/** What a check-in interval implies: "Late after 10 min, silent after 30 min". */
export function thresholdsText(minutes: number): string {
  return `Late after ${spanText(minutes * LATE_AFTER_INTERVALS)}, silent after ${spanText(minutes * SILENT_AFTER_INTERVALS)}`;
}

/** What the squadron page offers in its header (canvas, SqSailing and SqMenu). */
export interface SquadronActionsOffered {
  canAddMember: boolean;
  canMessageFlagship: boolean;
  canStandDown: boolean;
  canForceStandDown: boolean;
}

/**
 * The squadron header's actions for its state and the session's scopes: Add
 * member while Sailing with a role to add; Message to the flagship and Force
 * stand down until Disbanded, as Aeolus blocks no message; Stand down while
 * Sailing. A session that may not manage the fleet (a viewer's) adds and
 * stands down nothing; one that may not send messages nothing.
 */
export function squadronActionsOffered(
  squadron: Pick<Squadron, 'state'>,
  session: { canManage: boolean; canSend: boolean; hasRoles: boolean },
): SquadronActionsOffered {
  const isSailing = squadron.state === 'sailing';
  return {
    canAddMember: session.canManage && isSailing && session.hasRoles,
    canMessageFlagship: session.canSend && squadron.state !== 'disbanded',
    canStandDown: session.canManage && isSailing,
    canForceStandDown: session.canManage && squadron.state !== 'disbanded',
  };
}

/** How many crewed members report each work state, in the order the summary says them (working, idle, blocked); states no member reports are left out. */
export function workCounts(reports: readonly ({ state: ReportState } | null)[]): { state: ReportState; count: number }[] {
  const order: ReportState[] = ['working', 'idle', 'blocked'];
  return order.map((state) => ({ state, count: reports.filter((report) => report?.state === state).length })).filter((each) => each.count > 0);
}

/**
 * A role's hand-offs in its blueprint, by role (canvas, SqMemberShip): the
 * roles that hand off to it, and where its own hand-offs go (a role or
 * `flagship`), each named once, in blueprint order.
 */
export function handoffsOf(blueprint: Pick<BlueprintVersion, 'handoffs'>, role: string): { from: string[]; to: string[] } {
  const unique = (names: readonly string[]) => [...new Set(names)];
  return {
    from: unique(blueprint.handoffs.filter((handoff) => handoff.to === role).map((handoff) => handoff.role)),
    to: unique(blueprint.handoffs.filter((handoff) => handoff.role === role).map((handoff) => handoff.to)),
  };
}

/** "from implementer · to implementer, flagship": a role's hand-offs in words; "None" when it has none. */
export function handoffsText(handoffs: { from: readonly string[]; to: readonly string[] }): string {
  const parts = [
    handoffs.from.length > 0 ? `from ${handoffs.from.join(', ')}` : undefined,
    handoffs.to.length > 0 ? `to ${handoffs.to.join(', ')}` : undefined,
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? 'None' : parts.join(' · ');
}
