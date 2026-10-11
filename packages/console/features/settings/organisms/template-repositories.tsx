'use client';

import { CircleAlert, KeyRound, Plus, RotateCw, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';

import { relativeTime } from '../../../lib/relative-time';
import { leftOutLabel, repositoryContents, type NamedVersions, type RepositoryContents } from '../../../lib/repository';
import type { Catalogue, TemplateRepository } from '../../../lib/squadrons-schemas';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../components/atoms/alert-dialog';
import { Button } from '../../../components/atoms/button';
import { dialogSurface } from '../../../components/atoms/dialog-surface';
import { Input } from '../../../components/atoms/input';
import { Label } from '../../../components/atoms/label';
import { EmptyState } from '../../../components/molecules/empty-state';
import { InlineError } from '../../../components/molecules/inline-error';
import { LoadingSkeleton } from '../../../components/molecules/loading-skeleton';
import { RepositoryName } from '../../../components/molecules/repository-name';

/** Where squadrons looks in a repository when no path is given (docs/squadrons.md, "Files in git"). */
const DEFAULT_PATH = '.aeolus/squadrons';

interface TemplateRepositoriesProps {
  repositories: readonly TemplateRepository[];
  /** What squadrons read from them; undefined until it is loaded. */
  catalogue?: Catalogue;
  state: 'loading' | 'error' | 'ready';
  /** Why the list could not be read. */
  error?: string;
  onRetry: () => void;
  isAdding: boolean;
  /** Why the last add was refused, as squadrons says it. */
  addError?: string;
  onAdd: (repository: { url: string; path?: string; token?: string }, done: () => void) => void;
  isRemoving: boolean;
  /** Why the last remove failed; cleared through onRemoveClosed, so the next remove starts without it. */
  removeError?: string;
  onRemove: (name: string, done: () => void) => void;
  onRemoveClosed: () => void;
  isRefreshing: boolean;
  refreshError?: string;
  onRefresh: () => void;
  now: Date;
}

function AddRepository({ isAdding, addError, onAdd }: Pick<TemplateRepositoriesProps, 'isAdding' | 'addError' | 'onAdd'>) {
  const urlId = useId();
  const pathId = useId();
  const tokenId = useId();
  const [url, setUrl] = useState('');
  const [path, setPath] = useState('');
  const [token, setToken] = useState('');
  return (
    <form
      noValidate
      data-testid="repositories-add"
      className="flex flex-col gap-3 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmedPath = path.trim();
        const trimmedToken = token.trim();
        onAdd({ url: url.trim(), ...(trimmedPath === '' ? {} : { path: trimmedPath }), ...(trimmedToken === '' ? {} : { token: trimmedToken }) }, () => {
          setUrl('');
          setPath('');
          setToken('');
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={urlId}>Repository URL</Label>
          <Input
            id={urlId}
            isMono
            autoComplete="off"
            spellCheck={false}
            placeholder="https://github.com/acme/squadron-templates.git"
            data-testid="repositories-url"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={pathId}>Path (optional)</Label>
          <Input
            id={pathId}
            isMono
            autoComplete="off"
            spellCheck={false}
            placeholder={DEFAULT_PATH}
            data-testid="repositories-path"
            value={path}
            onChange={(event) => {
              setPath(event.target.value);
            }}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={tokenId}>Read token (optional, for a private repository)</Label>
        <Input
          id={tokenId}
          type="password"
          autoComplete="new-password"
          data-testid="repositories-token"
          value={token}
          onChange={(event) => {
            setToken(event.target.value);
          }}
        />
        <p className="text-meta text-muted-foreground">Entered once and never shown again. To change it, remove the repository and add it again.</p>
      </div>
      {addError === undefined ? null : <InlineError title="Couldn’t add the repository" description={`${addError} The list shows what squadrons holds.`} />}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" icon={<Plus aria-hidden />} isLoading={isAdding} disabled={url.trim() === ''} data-testid="repositories-add-submit">
          {isAdding ? 'Adding' : 'Add repository'}
        </Button>
      </div>
    </form>
  );
}

/** Templates as tester@1, 2; blueprints as team v1, v2: how the console shows their versions elsewhere. */
function versionsLine(named: readonly NamedVersions[], kind: 'template' | 'blueprint'): string {
  return named.map(({ name, versions }) => (kind === 'template' ? `${name}@${versions.join(', ')}` : `${name} v${versions.join(', v')}`)).join(' · ');
}

/** What squadrons found in a repository it fetched, and every version or tag it left out with why, so the operator can fix it in git. */
function RepositoryFindings({ contents, path }: { contents: RepositoryContents; path: string }) {
  const { templates, blueprints, leftOut } = contents;
  return (
    <>
      <dl data-testid="repositories-found" className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-meta">
        {templates.length === 0 && blueprints.length === 0 ? (
          <>
            <dt className="text-muted-foreground">Found</dt>
            <dd>No templates or blueprints under {path}</dd>
          </>
        ) : (
          <>
            <dt className="text-muted-foreground">Templates</dt>
            <dd className="font-mono">{templates.length === 0 ? 'None' : versionsLine(templates, 'template')}</dd>
            <dt className="text-muted-foreground">Blueprints</dt>
            <dd className="font-mono">{blueprints.length === 0 ? 'None' : versionsLine(blueprints, 'blueprint')}</dd>
          </>
        )}
      </dl>
      {leftOut.length === 0 ? null : (
        <div data-testid="repositories-left-out" className="flex flex-col gap-1.5 rounded-md border border-tone-attention-border bg-tone-attention-bg p-2.5 text-tone-attention-fg">
          <p className="flex items-center gap-1.5 text-meta font-medium">
            <TriangleAlert aria-hidden className="size-(--size-icon-sm) shrink-0" />
            Left out: {leftOut.length}. Fix {leftOut.length === 1 ? 'it' : 'them'} in git, tag again, then refresh.
          </p>
          <ul className="flex flex-col gap-1">
            {leftOut.map((problem) => (
              <li key={`${problem.kind} ${problem.name}@${String(problem.version)}`} data-testid="repositories-left-out-item" className="text-meta text-foreground">
                <span className="font-mono">{leftOutLabel(problem)}</span>: {problem.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function RepositoryRow({ repository, contents, now, onRemove }: { repository: TemplateRepository; contents?: RepositoryContents; now: Date; onRemove: () => void }) {
  const { lastFetch } = repository;
  return (
    <li data-testid="repositories-row" className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <RepositoryName name={repository.name} />
        {repository.path === DEFAULT_PATH ? null : <span className="font-mono text-meta text-muted-foreground">{repository.path}</span>}
        {repository.hasToken ? (
          <span className="inline-flex items-center gap-1 text-meta text-muted-foreground">
            <KeyRound aria-hidden className="size-(--size-icon-sm)" />
            Token
          </span>
        ) : null}
        <span className="ml-auto text-meta text-muted-foreground" data-testid="repositories-fetched">
          {lastFetch === null ? 'Not fetched yet' : `Fetched ${relativeTime(new Date(lastFetch.at), now)}`}
        </span>
        <Button size="xs" variant="ghost" data-testid="repositories-remove" onClick={onRemove}>
          Remove
        </Button>
      </div>
      {lastFetch?.error ? (
        <p data-testid="repositories-error" className="flex items-start gap-1.5 text-meta text-destructive-text">
          <CircleAlert aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0" />
          <span>
            The last fetch failed: <span className="font-mono">{lastFetch.error}</span>
          </span>
        </p>
      ) : null}
      {contents === undefined || lastFetch === null || (lastFetch.error !== null && contents.templates.length + contents.blueprints.length + contents.leftOut.length === 0) ? null : (
        <RepositoryFindings contents={contents} path={repository.path} />
      )}
    </li>
  );
}

/**
 * Settings, Squadrons, Repositories (#161, docs/squadrons.md "Template
 * repositories"): the repositories squadrons reads templates and blueprints
 * from, each with its last fetch and why it failed, what squadrons found in
 * it, and every version or tag it left out with why; add one by its https URL
 * with an optional path and a write-only read token; remove one with a normal
 * confirm; Refresh fetches them all. Beyond these, squadrons fetches only once
 * when it connects and when it starts.
 */
export function TemplateRepositories(props: TemplateRepositoriesProps) {
  const { repositories, catalogue, state, error, onRetry, isRemoving, removeError, onRemove, onRemoveClosed, isRefreshing, refreshError, onRefresh, now } = props;
  const [removing, setRemoving] = useState<string | undefined>(undefined);
  return (
    <section aria-labelledby="settings-repositories" data-testid="settings-repositories" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="settings-repositories" className="text-body font-semibold">
          Repositories
        </h2>
        <Button size="xs" icon={<RotateCw aria-hidden />} isLoading={isRefreshing} disabled={repositories.length === 0} onClick={onRefresh} data-testid="repositories-refresh">
          Refresh
        </Button>
      </div>
      <p className="text-meta text-muted-foreground">
        squadrons reads templates and blueprints from these repositories, under {DEFAULT_PATH} unless a repository sets its own path. It fetches one when you add it, when you refresh, and once each time squadrons connects or starts.
      </p>
      {refreshError === undefined ? null : <InlineError variant="section" title="Couldn’t refresh" description={refreshError} />}
      {state === 'loading' ? (
        <LoadingSkeleton variant="list" rows={2} label="Loading the repositories" />
      ) : state === 'error' ? (
        <InlineError title="Couldn’t read the repositories" description={error} onRetry={onRetry} />
      ) : repositories.length === 0 ? (
        <EmptyState variant="section" title="No repositories yet" description="Add one to read its templates and blueprints." />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {repositories.map((repository) => (
            <RepositoryRow
              key={repository.name}
              repository={repository}
              {...(catalogue === undefined ? {} : { contents: repositoryContents(catalogue, repository.name) })}
              now={now}
              onRemove={() => {
                setRemoving(repository.name);
              }}
            />
          ))}
        </ul>
      )}
      <AddRepository isAdding={props.isAdding} addError={props.addError} onAdd={props.onAdd} />
      <AlertDialog
        open={removing !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isRemoving) {
            setRemoving(undefined);
            onRemoveClosed();
          }
        }}
      >
        <AlertDialogContent data-testid="repositories-remove-dialog" className={dialogSurface.phoneSheet}>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its templates and blueprints leave the catalogue at once. Squadrons formed from them keep the versions they formed from.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeError === undefined ? null : <InlineError title="Couldn’t remove the repository" description={`${removeError} The list shows what squadrons holds.`} />}
          <AlertDialogFooter>
            <AlertDialogClose render={<Button disabled={isRemoving} />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              isLoading={isRemoving}
              data-testid="repositories-remove-confirm"
              onClick={() => {
                if (removing !== undefined) {
                  onRemove(removing, () => {
                    setRemoving(undefined);
                    onRemoveClosed();
                  });
                }
              }}
            >
              Remove repository
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
