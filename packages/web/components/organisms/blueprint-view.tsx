'use client';

import { ArrowRight, Flag, Lock, Plus } from 'lucide-react';

import { dayDate } from '../../lib/relative-time';
import type { Squadron, TemplateVersion } from '../../lib/squadrons-api';
import { checkInText, type BlueprintChoice } from '../../lib/squadrons-view';
import { Badge } from '../atoms/badge';
import { Button } from '../atoms/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../atoms/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../atoms/table';
import { SquadronTag } from '../molecules/squadron-tag';
import { StatusBadge } from '../molecules/status-badge';

interface BlueprintViewProps {
  blueprint: BlueprintChoice;
  /** The version shown; one of the blueprint's. */
  version: number;
  onVersionChange: (version: number) => void;
  templates: readonly TemplateVersion[];
  /** The squadrons formed from this blueprint, any version. */
  squadrons: readonly Squadron[];
  onForm: () => void;
}

const FLAGSHIP = 'flagship';

/** A hand-off's end: a role chip, or the flagship's kind chip. */
function HandoffEnd({ name }: { name: string }) {
  return name === FLAGSHIP ? (
    <Badge variant="kind">
      <Flag aria-hidden />
      flagship
    </Badge>
  ) : (
    <Badge variant="type">{name}</Badge>
  );
}

/**
 * One blueprint version, read only (docs/design/png/BlueprintView.png): its
 * roles with template versions, counts, check-in intervals and launch notes;
 * its hand-offs; its versions from git; and the squadrons formed from it. The
 * version switches with a Select; Form squadron starts forming with this
 * version picked. Blueprints are edited in git.
 */
export function BlueprintView({ blueprint, version, onVersionChange, templates, squadrons, onForm }: BlueprintViewProps) {
  const shown = blueprint.versions.find((each) => each.version === version) ?? blueprint.versions[0];
  if (!shown) {
    return null;
  }
  const latest = blueprint.versions[0]?.version;
  const versionItems = Object.fromEntries(blueprint.versions.map((each) => [String(each.version), `v${String(each.version)}${each.version === latest ? ' (latest)' : ''}`]));
  const templateOf = (reference: { repository: string; name: string; version: number }) =>
    templates.find((each) => each.repository === reference.repository && each.name === reference.name && each.version === reference.version);

  return (
    <div data-testid="blueprint-view" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="secondary">Blueprint</Badge>
        <Select
          items={versionItems}
          value={String(shown.version)}
          onValueChange={(value) => {
            onVersionChange(Number(value));
          }}
        >
          <SelectTrigger aria-label="Version" data-testid="blueprint-version">
            <span className="text-muted-foreground">Version</span>
            <SelectValue className="font-medium" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(versionItems).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-meta text-muted-foreground">
          <span className="font-mono">{shown.repository}</span> at <span className="font-mono">{shown.commit.slice(0, 7)}</span>, {dayDate(new Date(shown.committedAt))}
        </span>
        <Button variant="primary" icon={<Plus aria-hidden />} onClick={onForm} className="ml-auto" data-testid="blueprint-form">
          Form squadron
        </Button>
      </div>
      <p className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-meta text-muted-foreground">
        <Lock aria-hidden className="size-(--size-icon-sm) shrink-0" />
        Read-only. Blueprints are edited in git; new tags show up here as new versions.
      </p>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <section aria-labelledby="blueprint-roles" className="flex flex-col gap-2">
            <h2 id="blueprint-roles" className="text-body font-semibold">
              Roles
            </h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Check-in</TableHead>
                  <TableHead>Launch note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.roles.map((role) => {
                  const template = templateOf(role.template);
                  return (
                    <TableRow key={role.name} data-testid="blueprint-role">
                      <TableCell>
                        <Badge variant="type">{role.name}</Badge>
                      </TableCell>
                      <TableCell className="font-mono">{`${role.template.name}@${String(role.template.version)}`}</TableCell>
                      <TableCell>{role.count}</TableCell>
                      <TableCell>{template ? checkInText(template.checkInMinutes) : 'unknown'}</TableCell>
                      <TableCell className="max-w-64 truncate text-muted-foreground">{template?.launchNote ?? ''}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </section>
          <section aria-labelledby="blueprint-handoffs" className="flex flex-col gap-2">
            <h2 id="blueprint-handoffs" className="text-body font-semibold">
              Hand-offs
            </h2>
            {shown.handoffs.length === 0 ? (
              <p className="text-meta text-muted-foreground">No hand-offs: members hand nothing to each other.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
                {shown.handoffs.map((handoff) => (
                  <li key={`${handoff.role}.${handoff.handoff}`} className="flex items-center gap-2 text-meta">
                    <HandoffEnd name={handoff.role} />
                    <span className="font-mono text-muted-foreground">{handoff.handoff}</span>
                    <ArrowRight aria-label="goes to" className="size-(--size-icon-sm) text-muted-foreground" />
                    <HandoffEnd name={handoff.to} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="flex flex-col gap-5">
          <section aria-labelledby="blueprint-versions" className="flex flex-col gap-2">
            <h2 id="blueprint-versions" className="text-body font-semibold">
              Versions
            </h2>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {blueprint.versions.map((each) => (
                <li key={each.version} className="flex gap-3 px-3 py-2 text-meta">
                  <span className="font-mono font-medium">v{each.version}</span>
                  <span className="flex flex-col gap-0.5">
                    <span>
                      {each.description} {each.version === latest && <Badge variant="outline">Latest</Badge>}
                    </span>
                    <span className="text-muted-foreground">
                      {dayDate(new Date(each.committedAt))} · <span className="font-mono">{each.commit.slice(0, 7)}</span>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="blueprint-squadrons" className="flex flex-col gap-2">
            <h2 id="blueprint-squadrons" className="text-body font-semibold">
              Squadrons from this blueprint
            </h2>
            {squadrons.length === 0 ? (
              <p className="text-meta text-muted-foreground">None yet.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
                {squadrons.map((squadron) => (
                  <li key={squadron.id} className="flex items-center gap-2 text-meta">
                    <SquadronTag squadronId={squadron.id} size="sm" />
                    <span className="text-muted-foreground">v{squadron.blueprint.version}</span>
                    <StatusBadge status={squadron.state} className="ml-auto" />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
