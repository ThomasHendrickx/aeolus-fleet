import type { CrewLine, ShipDetail } from '@aeolus-fleet/common';
import { FileText, Info, Inbox } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import type { BlueprintVersion, Squadron, TemplateVersion } from '../../lib/squadrons-api';
import { lastSeen } from '../../lib/relative-time';
import { checkInText, membersByRole } from '../../lib/squadrons-view';
import { CrewLines } from '../molecules/crew-lines';
import { EmptyState } from '../molecules/empty-state';
import { HealthIndicator } from '../molecules/health-indicator';
import { LocationTag } from '../molecules/location-tag';
import { ReportLine } from '../molecules/report-line';
import { StatusBadge } from '../molecules/status-badge';

/** A member's crew lines and launch note, from the forming answer: shown once, never stored. */
export interface IssuedCrewLine {
  crewLines: readonly CrewLine[];
  launchNote: string | null;
}

interface MemberListProps {
  squadron: Squadron;
  /** The blueprint version it formed from, when the catalogue still has it: each role's template and interval. */
  blueprint: BlueprintVersion | undefined;
  templates: readonly TemplateVersion[];
  /** The crew lines forming handed out, by ship id, while this browser still holds them. */
  crewLines: ReadonlyMap<string, IssuedCrewLine>;
  /** Each member's ship as the fleet has it, by ship id, once loaded: report, location and open deliveries. */
  ships: ReadonlyMap<string, ShipDetail>;
  /** The time reports are measured from. */
  now: Date;
  /** A member's actions at the end of its row: Get new crew line, Remove from squadron. */
  renderActions?: (member: Squadron['members'][number]) => ReactNode;
}

/** For a late or silent member, when its session last called the fleet. */
function healthDetail(member: Squadron['members'][number], { ship, now }: { ship: ShipDetail | undefined; now: Date }): string | undefined {
  const { lastSeenAt } = member.crew;
  if ((member.health !== 'late' && member.health !== 'silent') || lastSeenAt === null) {
    return undefined;
  }
  const seen = lastSeen(new Date(lastSeenAt), now).replace(/^Last/, 'last');
  // Where its session runs, as the canvas words it (SqSailing): "last seen 34 min ago on MacBook".
  const device = ship?.location?.description;
  return device ? `${seen} on ${device}` : seen;
}

/** A member's ship from the fleet: awaiting crew, or its report, and where its session runs and its open deliveries. */
function FleetFacts({ ship, now }: { ship: ShipDetail | undefined; now: Date }) {
  if (!ship) {
    return null;
  }
  return (
    <div className="flex grow flex-wrap items-center justify-end gap-x-4 gap-y-1 text-meta">
      {ship.status === 'crewed' ? (
        <ReportLine report={ship.report} now={now} variant="row" testId="member-report" />
      ) : (
        <StatusBadge status={ship.status} />
      )}
      {ship.location ? (
        <LocationTag kind={ship.location.kind} description={ship.location.description} isCompact size="sm" />
      ) : (
        <span className="text-muted-foreground">No session</span>
      )}
      <span className="flex items-center gap-1 text-muted-foreground" data-testid="member-inbox">
        <Inbox aria-hidden className="size-(--size-icon-sm)" />
        {ship.openDeliveries}
        <span className="sr-only"> open</span>
      </span>
    </div>
  );
}

function RoleHeading({
  role,
  blueprint,
  templates,
  count,
}: {
  role: string;
  blueprint: BlueprintVersion | undefined;
  templates: readonly TemplateVersion[];
  count: number;
}) {
  const reference = blueprint?.roles.find((each) => each.name === role)?.template;
  const template = templates.find((each) => each.repository === reference?.repository && each.name === reference.name && each.version === reference.version);
  return (
    <div className="flex items-center gap-2 bg-muted px-3 py-1.5 text-meta">
      <span className="rounded-sm bg-card px-1.5 font-mono">{role}</span>
      {reference && <span className="font-mono text-muted-foreground">{`${reference.name}@${String(reference.version)}`}</span>}
      {template && <span className="text-muted-foreground">checks in {checkInText(template.checkInMinutes)}</span>}
      <span className="ml-auto text-muted-foreground">
        {count} {count === 1 ? 'member' : 'members'}
      </span>
    </div>
  );
}

/**
 * The squadron's members grouped by role (docs/design/png/MemberList.png),
 * each group headed by its template version and check-in interval. Each
 * member's name opens its ship page; it shows its health (on time, late, silent or not on station), and from the fleet its report, where
 * its session runs and its open deliveries. Right after forming, a member not on
 * station shows its crew lines and launch note in its row: once. Each row ends
 * with the actions the page gives it.
 */
export function MemberList({ squadron, blueprint, templates, crewLines, ships, now, renderActions }: MemberListProps) {
  if (squadron.members.length === 0) {
    return <EmptyState variant="section" title="No members" description="This squadron has no members." />;
  }
  return (
    <div data-testid="member-list" className="flex flex-col overflow-hidden rounded-lg border border-border">
      {membersByRole(squadron.members).map((group) => (
        <section key={group.role} aria-label={`Role ${group.role}`}>
          <RoleHeading role={group.role} blueprint={blueprint} templates={templates} count={group.members.length} />
          <ul className="divide-y divide-border">
            {group.members.map((member) => {
              const issued = member.onStationAt === null ? crewLines.get(member.shipId) : undefined;
              return (
                <li key={member.shipId} data-testid="member-row" className="flex flex-col gap-2 px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <Link href={`/ships/${member.shipId}`} className="font-medium hover:underline" data-testid="member-name">
                      {member.name}
                    </Link>
                    <HealthIndicator health={member.health} detail={healthDetail(member, { ship: ships.get(member.shipId), now })} className="shrink-0" />
                    {member.model.isMismatch && (
                      <span className="text-meta text-tone-attention-fg">
                        Runs {member.model.stated ?? 'an unstated model'}, not {member.model.pinned}
                      </span>
                    )}
                    <FleetFacts ship={ships.get(member.shipId)} now={now} />
                    {renderActions?.(member)}
                  </div>
                  {issued && (
                    <div className="flex flex-col gap-2">
                      {issued.launchNote !== null && (
                        <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-meta">
                          <FileText aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0" />
                          <span>
                            <span className="font-medium">Launch note</span> {issued.launchNote}
                          </span>
                        </p>
                      )}
                      <CrewLines crewLines={issued.crewLines} subject={member.name} testIdPrefix="member-crew-line" />
                      <p className="flex items-center gap-1.5 text-meta text-muted-foreground">
                        <Info aria-hidden className="size-(--size-icon-sm) shrink-0" />
                        <span>
                          <span className="font-medium">Shown once.</span> Paste a crew line into Claude Code or Codex started where the launch note says.
                        </span>
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
