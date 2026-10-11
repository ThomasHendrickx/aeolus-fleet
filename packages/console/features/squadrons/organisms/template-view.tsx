'use client';

import { DraftingCompass, FileText, GitCommitHorizontal, Lock } from 'lucide-react';
import Link from 'next/link';

import { dayDate, dayMonth } from '../../../lib/relative-time';
import type { BlueprintVersion } from '../../../lib/squadrons-schemas';
import { blueprintPath, blueprintsUsing, checkInText, thresholdsText, type TemplateChoice } from '../../../lib/squadrons-view';
import { Badge } from '../../../components/atoms/badge';
import { CodeBlock } from '../../../components/atoms/code-block';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/atoms/select';

interface TemplateViewProps {
  template: TemplateChoice;
  /** The version shown; one of the template's. */
  version: number;
  onVersionChange: (version: number) => void;
  blueprints: readonly BlueprintVersion[];
}

function capitalised(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/**
 * One ship template version, read only (docs/design/png/TemplateView.png):
 * its source file and commit, its charter as written, its check-in interval
 * with the late and silent thresholds it implies, its launch note, pinned
 * model and hand-offs, the blueprints that use it and its versions from git.
 * The version switches with a Select. Templates are edited in git.
 */
export function TemplateView({ template, version, onVersionChange, blueprints }: TemplateViewProps) {
  const shown = template.versions.find((each) => each.version === version) ?? template.versions[0];
  if (!shown) {
    return null;
  }
  const latest = template.versions[0]?.version;
  const label = `${shown.name}@${String(shown.version)}`;
  const versionItems = Object.fromEntries(template.versions.map((each) => [String(each.version), `v${String(each.version)}${each.version === latest ? ' (latest)' : ''}`]));
  const usedBy = blueprintsUsing(blueprints, shown);

  return (
    <div data-testid="template-view" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="secondary">Template</Badge>
        <Select
          items={versionItems}
          value={String(shown.version)}
          onValueChange={(value) => {
            onVersionChange(Number(value));
          }}
        >
          <SelectTrigger aria-label="Version" data-testid="template-version">
            <span className="text-muted-foreground">Version</span>
            <SelectValue className="font-medium" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(versionItems).map(([value, item]) => (
              <SelectItem key={value} value={value}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span data-testid="template-source" className="flex items-center gap-1 text-meta text-muted-foreground">
          <GitCommitHorizontal aria-hidden className="size-(--size-icon-sm)" />
          <span className="font-mono">{shown.file}</span> at <span className="font-mono">{shown.commit.slice(0, 7)}</span>, {dayDate(new Date(shown.committedAt))}
        </span>
      </div>
      <p className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-meta text-muted-foreground">
        <Lock aria-hidden className="size-(--size-icon-sm) shrink-0" />
        Read-only. Templates are edited in git; new tags show up here as new versions.
      </p>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-labelledby="template-charter" className="flex flex-col gap-2">
          <h2 id="template-charter" className="text-body font-semibold">
            Charter
          </h2>
          <CodeBlock label={`Charter · ${label}`} code={shown.charter} isWrapped codeTestId="template-charter-text" />
        </section>
        <div className="flex flex-col gap-5">
          <section aria-label="Check-in and launch" className="flex flex-col gap-3 rounded-lg border border-border p-3 text-meta">
            <div className="flex flex-col gap-0.5">
              <span className="text-muted-foreground">Check-in interval</span>
              <span className="font-medium" data-testid="template-check-in">
                {capitalised(checkInText(shown.checkInMinutes))}
              </span>
              <span className="text-muted-foreground">{thresholdsText(shown.checkInMinutes)}.</span>
            </div>
            {shown.model !== null && (
              <div className="flex flex-col gap-0.5">
                <span className="text-muted-foreground">Model</span>
                <span className="font-mono">{shown.model}</span>
              </div>
            )}
            {shown.launchNote !== null && (
              <div className="flex items-start gap-2 rounded-md bg-muted px-3 py-2">
                <FileText aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0 text-muted-foreground" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground">Launch note · {label}</span>
                  <span>{shown.launchNote}</span>
                </span>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">Used by</span>
              {usedBy.length === 0 ? (
                <span className="text-muted-foreground">No blueprint uses this version.</span>
              ) : (
                <span className="flex flex-wrap gap-1.5">
                  {usedBy.map((blueprint) => (
                    <Badge key={`${blueprint.repository}#${blueprint.name}@${String(blueprint.version)}`} variant="type" render={<Link href={blueprintPath(blueprint)} />}>
                      <DraftingCompass aria-hidden />
                      {blueprint.name} v{blueprint.version}
                    </Badge>
                  ))}
                </span>
              )}
            </div>
          </section>
          <section aria-labelledby="template-handoffs" className="flex flex-col gap-2">
            <h2 id="template-handoffs" className="text-body font-semibold">
              Hand-offs
            </h2>
            {shown.handoffs.length === 0 ? (
              <p className="text-meta text-muted-foreground">None: its charter hands nothing to other roles.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 rounded-lg border border-border p-3 text-meta">
                {shown.handoffs.map((handoff) => (
                  <li key={handoff.name} data-testid="template-handoff" className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono">{handoff.name}</span>
                    <span className="text-muted-foreground">{handoff.carries}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="template-versions" className="flex flex-col gap-2">
            <h2 id="template-versions" className="text-body font-semibold">
              Versions
            </h2>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {template.versions.map((each) => {
                const users = blueprintsUsing(blueprints, each);
                return (
                  <li key={each.version} className="flex gap-3 px-3 py-2 text-meta">
                    <span className="font-medium">v{each.version}</span>
                    <span className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        {each.description}
                        {each.version === latest && <Badge variant="secondary">Latest</Badge>}
                      </span>
                      <span className="text-muted-foreground">
                        {dayMonth(new Date(each.committedAt))} · <span className="font-mono">{each.commit.slice(0, 7)}</span>
                        {users.length > 0 && ` · ${users.map((blueprint) => `${blueprint.name} v${String(blueprint.version)}`).join(', ')}`}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
