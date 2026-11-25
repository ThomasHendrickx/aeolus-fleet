import { Check, CircleAlert, LoaderCircle, RotateCw, Trash2 } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { Badge, Button, EmptyState, InlineError, LoadingSkeleton, Switch, Tooltip, TooltipContent, TooltipTrigger } from '@aeolus-fleet/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../components/atoms/table';
import type { GuardConfiguration } from '../../../../lib/trierarch-plugin-guard-schemas';
import type { RepositoryUpdate } from '../../services/guard-configuration';

const SHORT_COMMIT_LENGTH = 7;

type Repository = GuardConfiguration['repositories'][number];
type RuleSet = GuardConfiguration['sets'][number];

interface Management {
  isDisabled: boolean;
  floorSave?: { name: string; state: 'pending' | 'success' | 'failure' };
  repositoryUpdates?: ReadonlyMap<string, RepositoryUpdate>;
  onUpdate: (repository: string) => void;
  onAdd: () => void;
  onRemove: (repository: string) => void;
  onSetFloor: (name: string, isIncluded: boolean) => void;
}

function SectionTitle({ children, count }: { children: ReactNode; count?: number }) {
  return <h2 className="flex items-center gap-2 text-section font-semibold">{children}{count === undefined ? null : <Badge variant="count">{count}</Badge>}</h2>;
}

function Commit({ commit }: { commit: string | null }) {
  return commit === null ? null : <span title={commit} className="font-mono text-id text-muted-foreground">{commit.slice(0, SHORT_COMMIT_LENGTH)}</span>;
}

function countLabel(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function RepositoryStatus({ setCount, errorCount }: { setCount: number; errorCount: number }) {
  return errorCount === 0 ? countLabel(setCount, 'rule set') : (
    <span className="inline-flex items-center gap-1.5 text-destructive-text">
      <CircleAlert aria-hidden className="size-(--size-icon-sm)" />
      {countLabel(errorCount, 'error')}
    </span>
  );
}

function RemoveRepository({ repository, management }: { repository: string; management: Management }) {
  return (
    <Tooltip>
      <TooltipTrigger render={(
        <Button
          size="xs"
          variant="ghost"
          isIconOnly
          icon={<Trash2 aria-hidden />}
          aria-label={`Remove ${repository}`}
          data-testid={`rule-sets-remove-${repository}`}
          className="max-sm:size-(--size-control-touch)"
          disabled={management.isDisabled}
          onClick={() => { management.onRemove(repository); }}
        />
      )} />
      <TooltipContent>Remove repository</TooltipContent>
    </Tooltip>
  );
}

function RepositoryActions({ repository, management }: { repository: string; management: Management }) {
  const state = management.repositoryUpdates?.get(repository)?.state ?? 'idle';
  const isUpdating = state === 'pending';
  const label = isUpdating ? 'Updating' : 'Update';
  return (
    <div className="flex shrink-0 items-start justify-end gap-1 sm:items-center">
      <div className="flex items-center gap-2 max-sm:flex-col max-sm:gap-1">
        {state === 'success' ? (
          <span role="status" className="inline-flex items-center gap-1 whitespace-nowrap text-meta text-tone-ok-fg max-sm:order-last">
            <Check aria-hidden className="size-(--size-icon-sm)" /> Updated
          </span>
        ) : null}
        <Button
          variant="secondary"
          size="xs"
          icon={<RotateCw aria-hidden className="size-(--size-icon-sm)" />}
          isLoading={isUpdating}
          disabled={management.isDisabled}
          aria-label={`${label} ${repository}`}
          data-testid={`rule-sets-update-${repository}`}
          data-state={state}
          className="max-sm:h-(--size-control-touch)"
          onClick={() => { management.onUpdate(repository); }}
        >
          {label}
        </Button>
      </div>
      <RemoveRepository repository={repository} management={management} />
    </div>
  );
}

function RepositoryUpdateFailure({ update }: { update: Extract<RepositoryUpdate, { state: 'failure' }> }) {
  return (
    <div role="alert" className="flex items-start gap-1.5 break-words py-2 text-meta">
      <CircleAlert aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0 text-destructive-text" />
      <div className="flex min-w-0 flex-col gap-x-2 sm:flex-row sm:flex-wrap">
        <span className="font-semibold text-destructive-text">Update failed</span>
        <span className="text-muted-foreground">{update.reason}</span>
        {update.hasStoredCopy ? <span className="text-muted-foreground">Kept the stored copy.</span> : null}
      </div>
    </div>
  );
}

function Repositories({ repositories, sets, errors, management }: {
  repositories: readonly Repository[];
  sets: readonly RuleSet[];
  errors: readonly GuardConfiguration['errors'][number][];
  management?: Management;
}) {
  const counts = new Map(repositories.map(({ repository }) => [repository, { setCount: 0, errorCount: 0 }]));
  for (const { repository } of sets) {
    const count = counts.get(repository);
    if (count !== undefined) count.setCount += 1;
  }
  for (const { repository } of errors) {
    const count = counts.get(repository);
    if (count !== undefined) count.errorCount += 1;
  }
  const status = (repository: string) => <RepositoryStatus {...(counts.get(repository) ?? { setCount: 0, errorCount: 0 })} />;
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <SectionTitle count={repositories.length}>Repositories</SectionTitle>
      <div className="max-sm:hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {['Repository', 'Folder', 'Read at commit', 'Status'].map((column) => <TableHead key={column}>{column}</TableHead>)}
              {management ? <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {repositories.map(({ repository, folder, readCommit }) => {
              const update = management?.repositoryUpdates?.get(repository);
              return (
                <Fragment key={repository}>
                  <TableRow>
                    <TableCell className="break-all font-mono text-id font-medium">{repository}</TableCell>
                    <TableCell className="break-all font-mono text-id text-muted-foreground">{folder}</TableCell>
                    <TableCell><Commit commit={readCommit} /></TableCell>
                    <TableCell className="text-meta text-muted-foreground">{status(repository)}</TableCell>
                    {management ? <TableCell><RepositoryActions repository={repository} management={management} /></TableCell> : null}
                  </TableRow>
                  {update?.state === 'failure' ? (
                    <TableRow className="h-auto hover:bg-transparent">
                      <TableCell colSpan={5}><RepositoryUpdateFailure update={update} /></TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card sm:hidden">
        {repositories.map(({ repository, folder, readCommit }) => {
          const update = management?.repositoryUpdates?.get(repository);
          return (
            <li key={repository}>
              <div className="flex items-start justify-between gap-2 px-3.5 py-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="break-all font-mono text-body-touch font-medium">{repository}</span>
                  {folder || readCommit !== null ? (
                    <span className="break-all font-mono text-id text-muted-foreground">
                      {folder}{folder && readCommit !== null ? ' · ' : null}<Commit commit={readCommit} />
                    </span>
                  ) : null}
                  <span className="text-meta text-muted-foreground">{status(repository)}</span>
                </div>
                {management ? <RepositoryActions repository={repository} management={management} /> : null}
              </div>
              {update?.state === 'failure' ? (
                <div className="border-t border-border px-3.5"><RepositoryUpdateFailure update={update} /></div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Floor({ name, isIncluded, isUnavailable, management }: {
  name: string;
  isIncluded: boolean;
  isUnavailable?: boolean;
  management?: Management;
}) {
  if (management === undefined) {
    return <span className="text-meta text-muted-foreground"><span className="sm:hidden">Floor {isIncluded ? '· ' : ''}</span>{isIncluded ? 'Yes' : 'No'}</span>;
  }
  const state = management.floorSave?.name === name ? management.floorSave.state : 'idle';
  const isSaving = state === 'pending';
  if (isUnavailable) {
    return (
      <Button
        size="xs"
        isLoading={isSaving}
        disabled={management.isDisabled}
        aria-label={`Clear ${name} from the floor`}
        data-testid={`rule-sets-clear-${name}`}
        data-state={state}
        onClick={() => { management.onSetFloor(name, false); }}
      >
        {isSaving ? 'Clearing…' : 'Clear floor'}
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-meta text-muted-foreground">
      <Switch
        aria-label={`Floor for ${name}`}
        aria-busy={isSaving || undefined}
        checked={isIncluded}
        disabled={management.isDisabled}
        data-testid={`rule-sets-floor-${name}`}
        data-state={state}
        onCheckedChange={(isChecked) => { management.onSetFloor(name, isChecked); }}
      />
      {isSaving ? (
        <span className="inline-flex items-center gap-1" role="status">
          <LoaderCircle aria-hidden className="size-(--size-icon-sm) motion-safe:animate-spin" />Saving…
        </span>
      ) : <span aria-hidden className="sm:hidden">Floor</span>}
    </div>
  );
}

function RuleSets({ sets, floor, management, notice }: {
  sets: readonly RuleSet[];
  floor: readonly string[];
  management?: Management;
  notice?: ReactNode;
}) {
  const included = new Set(floor);
  const available = new Set(sets.map(({ name }) => name));
  const unavailable = floor.filter((name) => !available.has(name));
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <SectionTitle count={sets.length}>Rule sets</SectionTitle>
      {notice}
      {sets.length === 0 && unavailable.length === 0 ? <EmptyState variant="section" title="No rule sets are available." /> : (
        <>
          <div className="max-sm:hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  {['Name', 'Repository', 'Commit', 'Floor', 'Rules'].map((column) => <TableHead key={column}>{column}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sets.map(({ name, repository, commit, rulesCount }) => (
                  <TableRow key={name}>
                    <TableCell className="break-all font-mono text-id font-medium">{name}</TableCell>
                    <TableCell className="break-all font-mono text-id text-muted-foreground">{repository}</TableCell>
                    <TableCell><Commit commit={commit} /></TableCell>
                    <TableCell><Floor name={name} isIncluded={included.has(name)} management={management} /></TableCell>
                    <TableCell className="text-meta tabular-nums text-muted-foreground">{rulesCount}</TableCell>
                  </TableRow>
                ))}
                {unavailable.map((name) => (
                  <TableRow key={name}>
                    <TableCell className="break-all font-mono text-id font-medium">{name}</TableCell>
                    <TableCell colSpan={2} className="text-meta text-destructive-text">Unavailable</TableCell>
                    <TableCell><Floor name={name} isIncluded isUnavailable management={management} /></TableCell>
                    <TableCell />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border bg-card sm:hidden">
            {sets.map(({ name, repository, commit, rulesCount }) => (
              <li key={name} className="flex min-w-0 flex-col gap-1 px-3.5 py-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 break-all font-mono text-body-touch font-medium">{name}</span>
                  <Floor name={name} isIncluded={included.has(name)} management={management} />
                </div>
                <span className="break-all font-mono text-id text-muted-foreground">{repository} · <Commit commit={commit} /></span>
                <span className="text-meta text-muted-foreground">{countLabel(rulesCount, 'rule')}</span>
              </li>
            ))}
            {unavailable.map((name) => (
              <li key={name} className="flex items-center justify-between gap-2 px-3.5 py-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="break-all font-mono text-body-touch font-medium">{name}</span>
                  <span className="text-meta text-destructive-text">Unavailable</span>
                </div>
                <Floor name={name} isIncluded isUnavailable management={management} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function CatalogueError({ name, reason }: { name: string; reason: string }) {
  return (
    <li className="flex gap-2 px-3.5 py-3">
      <CircleAlert aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0 text-destructive-text" />
      <div className="min-w-0 break-words">
        <p className="font-mono text-id font-medium">{name}</p>
        <p className="text-meta text-muted-foreground">{reason}</p>
      </div>
    </li>
  );
}

/** The catalogue's ready, empty, loading and failed views share the same page chrome. */
export function RuleSetsPanel({ configuration, error, isReading, onReadAgain, management, floorNotice }: {
  configuration?: GuardConfiguration;
  error?: string;
  isReading: boolean;
  onReadAgain: () => void;
  management?: Management;
  floorNotice?: ReactNode;
}) {
  if (error !== undefined && !isReading) {
    return (
      <InlineError
        variant="page"
        title="Couldn’t read the rule sets"
        description="Try again to see the catalogue and floor."
        detail={error}
        onRetry={onReadAgain}
        className="min-w-0 break-words"
      />
    );
  }
  if (configuration === undefined || (error !== undefined && isReading)) {
    return (
      <div className="flex flex-col gap-3" aria-busy data-state="pending">
        <SectionTitle>Repositories</SectionTitle>
        <LoadingSkeleton variant="table" rows={2} label="Reading repositories" className="max-sm:hidden" />
        <LoadingSkeleton variant="list" rows={2} label="Reading repositories" className="sm:hidden" />
        <SectionTitle>Rule sets</SectionTitle>
        <LoadingSkeleton variant="table" rows={3} label="Reading rule sets" className="max-sm:hidden" />
        <LoadingSkeleton variant="list" rows={3} label="Reading rule sets" className="sm:hidden" />
      </div>
    );
  }

  const { repositories, sets, floor, errors, conflicts } = configuration;
  const catalogueErrors = errors.filter(({ repository, file, reason }) => {
    const update = management?.repositoryUpdates?.get(repository);
    return file !== undefined || update?.state !== 'failure' || update.reason !== reason;
  });
  const errorCount = catalogueErrors.length + conflicts.length;
  return (
    <div className="flex min-w-0 flex-col gap-6" data-state="success">
      {repositories.length === 0 ? (
        <EmptyState
          title="No rule set repositories"
          description="Add a repository that holds rule set files."
          action={management ? <Button variant="primary" disabled={management.isDisabled} onClick={management.onAdd} data-testid="rule-sets-add-repository">Add repository</Button> : undefined}
        />
      ) : (
        <>
          <p className="text-meta text-muted-foreground">
            Every crew request is checked against the floor and the rule set it names.
            A request keeps the commits it was assigned with. New requests use the stored copy.
          </p>
          <Repositories repositories={repositories} sets={sets} errors={catalogueErrors} management={management} />
        </>
      )}
      {repositories.length > 0 || floor.length > 0 ? <RuleSets sets={sets} floor={floor} management={management} notice={floorNotice} /> : null}
      {errorCount > 0 ? (
        <section className="flex min-w-0 flex-col gap-3">
          <SectionTitle count={errorCount}>Errors</SectionTitle>
          {management && catalogueErrors.some(({ file }) => file !== undefined) ? (
            <p className="text-meta text-muted-foreground">Fix the file in its repository, then select Update.</p>
          ) : null}
          {conflicts.length > 0 ? (
            <p className="text-meta text-muted-foreground">Rule set names must be unique across repositories.</p>
          ) : null}
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {catalogueErrors.map(({ repository, file, reason }) => (
              <CatalogueError key={JSON.stringify([repository, file, reason])} name={file ?? repository} reason={file === undefined ? reason : `${repository}: ${reason}`} />
            ))}
            {conflicts.map(({ name, repositories: sources }) => (
              <CatalogueError key={name} name={name} reason={`This name appears in more than one repository: ${sources.join(', ')}.`} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
