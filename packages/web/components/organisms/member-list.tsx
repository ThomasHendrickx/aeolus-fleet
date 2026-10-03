import { CircleCheck, CircleDashed, FileText, Info } from 'lucide-react';

import type { BlueprintVersion, Squadron, TemplateVersion } from '../../lib/squadrons-api';
import { checkInText, membersByRole } from '../../lib/squadrons-view';
import { CodeBlock } from '../atoms/code-block';
import { EmptyState } from '../molecules/empty-state';

/** A member's crew line and launch note, from the forming answer: shown once, never stored. */
export interface IssuedCrewLine {
  crewLine: string;
  launchNote: string | null;
}

interface MemberListProps {
  squadron: Squadron;
  /** The blueprint version it formed from, when the catalogue still has it: each role's template and interval. */
  blueprint: BlueprintVersion | undefined;
  templates: readonly TemplateVersion[];
  /** The crew lines forming handed out, by ship id, while this browser still holds them. */
  crewLines: ReadonlyMap<string, IssuedCrewLine>;
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
 * member says whether it is on station. Right after forming, a member not on
 * station shows its crew line and launch note in its row: once.
 */
export function MemberList({ squadron, blueprint, templates, crewLines }: MemberListProps) {
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
                    <span className="font-medium">{member.name}</span>
                    {member.onStationAt === null ? (
                      <span className="flex items-center gap-1 text-meta text-muted-foreground" data-testid="member-station">
                        <CircleDashed aria-hidden className="size-(--size-icon-sm)" />
                        Not on station
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-meta text-tone-ok-fg" data-testid="member-station">
                        <CircleCheck aria-hidden className="size-(--size-icon-sm)" />
                        On station
                      </span>
                    )}
                    {member.model.isMismatch && (
                      <span className="text-meta text-tone-attention-fg">
                        Runs {member.model.stated ?? 'an unstated model'}, not {member.model.pinned}
                      </span>
                    )}
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
                      <CodeBlock
                        label={`Crew line for ${member.name}`}
                        code={issued.crewLine}
                        isWrapped
                        copyLabel={`Copy the crew line for ${member.name}`}
                        codeTestId="member-crew-line"
                      />
                      <p className="flex items-center gap-1.5 text-meta text-muted-foreground">
                        <Info aria-hidden className="size-(--size-icon-sm) shrink-0" />
                        <span>
                          <span className="font-medium">Shown once.</span> Paste it into Claude Code started where the launch note says.
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
