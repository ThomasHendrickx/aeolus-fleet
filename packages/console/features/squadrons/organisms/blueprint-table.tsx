import { ChevronRight, DraftingCompass } from 'lucide-react';
import Link from 'next/link';

import { dayMonth } from '../../../lib/relative-time';
import { versionFileUrl } from '../../../lib/repository';
import type { Squadron } from '../../../lib/squadrons-schemas';
import { blueprintPath, rolesText, squadronsFromBlueprint, squadronsText, type BlueprintChoice } from '../../../lib/squadrons-view';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/atoms/table';
import { EmptyState } from '../../../components/molecules/empty-state';
import { InlineError } from '../../../components/molecules/inline-error';
import { LoadingSkeleton } from '../../../components/molecules/loading-skeleton';
import { RepositoryName } from '../../../components/molecules/repository-name';

interface BlueprintTableProps {
  blueprints: readonly BlueprintChoice[];
  squadrons: readonly Pick<Squadron, 'state' | 'blueprint'>[];
  state: 'loading' | 'error' | 'ready';
  /** Why the catalogue could not be read, as squadrons said it. */
  error?: string;
  onRetry: () => void;
}

/**
 * The Blueprints tab of Squadrons (docs/design/png/BlueprintTable.png): every
 * blueprint in git with its latest version, roles, the squadrons formed from
 * it and its last commit. Read only; a row opens its BlueprintView. Phone: one
 * card per blueprint.
 */
export function BlueprintTable({ blueprints, squadrons, state, error, onRetry }: BlueprintTableProps) {
  if (state === 'loading') {
    return <LoadingSkeleton variant="table" label="Loading blueprints" />;
  }
  if (state === 'error') {
    return (
      <InlineError
        variant="page"
        title="Couldn’t read blueprints from git"
        description="The squadron manager couldn’t fetch the squadrons repository. Running squadrons are not affected."
        detail={error}
        onRetry={onRetry}
      />
    );
  }
  if (blueprints.length === 0) {
    return (
      <EmptyState
        icon={<DraftingCompass aria-hidden />}
        title="No blueprints in git"
        description="The squadron manager reads blueprints from .aeolus/squadrons/blueprints. Commit one there; it shows up here on its own."
      />
    );
  }
  const rows = blueprints.flatMap((blueprint) => {
    const latest = blueprint.versions[0];
    return latest ? [{ blueprint, latest, formed: squadronsText(squadronsFromBlueprint(squadrons, blueprint)) }] : [];
  });
  return (
    <>
      <Table data-testid="blueprint-table" className="max-sm:hidden">
        <TableHeader>
          <TableRow>
            <TableHead>Blueprint</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Latest</TableHead>
            <TableHead>Roles</TableHead>
            <TableHead>Squadrons</TableHead>
            <TableHead>Committed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ blueprint, latest, formed }) => (
            <TableRow key={blueprint.key} data-testid="blueprint-row">
              <TableCell className="font-medium">
                <Link href={blueprintPath(blueprint)} className="hover:underline">
                  {blueprint.name}
                </Link>
              </TableCell>
              <TableCell data-testid="blueprint-row-source">
                <RepositoryName name={latest.repository} href={versionFileUrl(latest)} />
              </TableCell>
              <TableCell>v{latest.version}</TableCell>
              <TableCell>{rolesText(latest)}</TableCell>
              <TableCell className={formed === '' ? 'text-muted-foreground' : undefined}>{formed === '' ? 'None' : formed}</TableCell>
              <TableCell className="text-muted-foreground">
                {dayMonth(new Date(latest.committedAt))} · <span className="font-mono">{latest.commit.slice(0, 7)}</span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border sm:hidden">
        {rows.map(({ blueprint, latest }) => (
          <li key={blueprint.key}>
            <Link href={blueprintPath(blueprint)} className="flex items-center gap-2 px-3 py-2.5">
              <span className="flex min-w-0 grow flex-col gap-0.5">
                <span className="font-medium">
                  {blueprint.name} <span className="text-meta font-normal text-muted-foreground">v{latest.version}</span>
                </span>
                <span className="truncate text-meta text-muted-foreground">{rolesText(latest)}</span>
                <span className="flex min-w-0 text-meta text-muted-foreground">
                  <RepositoryName name={latest.repository} />
                </span>
              </span>
              <ChevronRight aria-hidden className="size-(--size-icon-sm) shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
