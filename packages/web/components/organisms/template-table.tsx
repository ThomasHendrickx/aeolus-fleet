import { ChevronRight, LayoutTemplate } from 'lucide-react';
import Link from 'next/link';

import { dayMonth } from '../../lib/relative-time';
import type { BlueprintVersion } from '../../lib/squadrons-api';
import { blueprintsUsing, checkInText, templatePath, type TemplateChoice } from '../../lib/squadrons-view';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../atoms/table';
import { EmptyState } from '../molecules/empty-state';
import { InlineError } from '../molecules/inline-error';
import { LoadingSkeleton } from '../molecules/loading-skeleton';

interface TemplateTableProps {
  templates: readonly TemplateChoice[];
  blueprints: readonly BlueprintVersion[];
  state: 'loading' | 'error' | 'ready';
  /** Why the catalogue could not be read, as squadrons said it. */
  error?: string;
  onRetry: () => void;
}

/** The names of the blueprints whose latest version runs any version of the template. */
function usedBy(template: TemplateChoice, blueprints: readonly BlueprintVersion[]): string {
  const latest = new Map<string, BlueprintVersion>();
  for (const blueprint of blueprints) {
    const key = `${blueprint.repository}#${blueprint.name}`;
    const known = latest.get(key);
    if (!known || known.version < blueprint.version) {
      latest.set(key, blueprint);
    }
  }
  return blueprintsUsing([...latest.values()], template)
    .map((blueprint) => blueprint.name)
    .sort()
    .join(', ');
}

/**
 * The Templates tab of Squadrons (docs/design/png/TemplateTable.png): every
 * ship template in git with its latest version, check-in interval and the
 * blueprints that use it. Read only; a row opens its TemplateView. Phone: one
 * card per template.
 */
export function TemplateTable({ templates, blueprints, state, error, onRetry }: TemplateTableProps) {
  if (state === 'loading') {
    return <LoadingSkeleton variant="table" label="Loading templates" />;
  }
  if (state === 'error') {
    return (
      <InlineError
        variant="page"
        title="Couldn’t read templates from git"
        description="The squadron manager couldn’t fetch the squadrons repository. Running squadrons are not affected."
        detail={error}
        onRetry={onRetry}
      />
    );
  }
  if (templates.length === 0) {
    return (
      <EmptyState
        icon={<LayoutTemplate aria-hidden />}
        title="No templates in git"
        description="The squadron manager reads templates from .aeolus/squadrons/templates. Commit one there; it shows up here on its own."
      />
    );
  }
  const rows = templates.flatMap((template) => {
    const latest = template.versions[0];
    return latest ? [{ template, latest, users: usedBy(template, blueprints) }] : [];
  });
  return (
    <>
      <Table data-testid="template-table" className="max-sm:hidden">
        <TableHeader>
          <TableRow>
            <TableHead>Template</TableHead>
            <TableHead>Latest</TableHead>
            <TableHead>Check-in</TableHead>
            <TableHead>Used by blueprints</TableHead>
            <TableHead>Committed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ template, latest, users }) => (
            <TableRow key={template.key} data-testid="template-row">
              <TableCell className="font-medium">
                <Link href={templatePath(template)} className="hover:underline">
                  {template.name}
                </Link>
              </TableCell>
              <TableCell>v{latest.version}</TableCell>
              <TableCell>{checkInText(latest.checkInMinutes)}</TableCell>
              <TableCell className={users === '' ? 'text-muted-foreground' : undefined}>{users === '' ? 'None' : users}</TableCell>
              <TableCell className="text-muted-foreground">{dayMonth(new Date(latest.committedAt))}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border sm:hidden">
        {rows.map(({ template, latest }) => (
          <li key={template.key}>
            <Link href={templatePath(template)} className="flex items-center gap-2 px-3 py-2.5">
              <span className="flex min-w-0 grow flex-col gap-0.5">
                <span className="font-medium">
                  {template.name} <span className="text-meta font-normal text-muted-foreground">v{latest.version}</span>
                </span>
                <span className="text-meta text-muted-foreground">{checkInText(latest.checkInMinutes)}</span>
              </span>
              <ChevronRight aria-hidden className="size-(--size-icon-sm) shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
