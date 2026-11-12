'use client';

import { Plus, X } from 'lucide-react';
import { useId } from 'react';

import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, InlineError, Input, Tooltip, TooltipContent, TooltipTrigger } from '@aeolus-fleet/ui';
import type { RepositoryChoice } from '../../lib/crew-settings-form';

interface SubRepositoriesFieldProps {
  shipName: string;
  /** The sub-repositories added, in the order added, each at its branch: empty for its default branch. */
  subRepositories: readonly RepositoryChoice[];
  /** What Add sub-repository offers: the harness's repositories, less the main repository and those added. */
  addable: readonly string[];
  /** The error under each row, by its place. */
  errors: readonly (string | undefined)[];
  isDisabled?: boolean;
  onAdd: (repository: string) => void;
  onBranchChange: (index: number, ref: string) => void;
  onRemove: (index: number) => void;
}

/**
 * A crew request's sub-repositories (docs/design/ship-repositories): "None"
 * when empty; each one a row with its name in mono, its own Branch and ×,
 * then Add sub-repository, which offers only what the answering machines
 * offer for the harness. Once every offered one is added it stays, off, and
 * says why, as Add server does. A row's error shows under it.
 */
export function SubRepositoriesField({ shipName, subRepositories, addable, errors, isDisabled = false, onAdd, onBranchChange, onRemove }: SubRepositoriesFieldProps) {
  const errorIdPrefix = useId();
  const isAllAdded = addable.length === 0;
  const addSubRepository = (
    <Button type="button" variant="ghost" size="xs" icon={<Plus />} disabled={isDisabled || isAllAdded} focusableWhenDisabled={isAllAdded && !isDisabled} data-testid="crew-settings-sub-repositories-add">
      Add sub-repository
    </Button>
  );
  return (
    <div className="flex flex-col gap-1.5" data-testid="crew-settings-sub-repositories">
      <span className="text-body font-medium">
        Sub-repositories<span className="font-normal text-muted-foreground"> optional</span>
      </span>
      {subRepositories.length === 0 ? null : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {subRepositories.map(({ repository, ref }, index) => {
            const error = errors[index];
            // The row's error explains the repository, so its Branch and × both carry it.
            const errorId = error === undefined ? undefined : `${errorIdPrefix}-${String(index)}`;
            return (
              // A repository may be named twice while the form says so, so its place keys it too.
              <li key={`${repository}-${String(index)}`} className="flex flex-col gap-1.5 px-2.5 py-2" data-testid="crew-settings-sub-repository-row">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-id" data-testid="crew-settings-sub-repository">
                    {repository}
                  </span>
                  <Input
                    isMono
                    aria-label={`Branch of ${repository}`}
                    aria-invalid={error === undefined ? undefined : true}
                    aria-describedby={errorId}
                    placeholder="Default branch"
                    className="h-(--size-control-sm) w-32 shrink-0 px-2 text-id sm:w-36"
                    value={ref}
                    disabled={isDisabled}
                    onChange={(event) => {
                      onBranchChange(index, event.target.value);
                    }}
                  />
                  {isDisabled ? (
                    <span aria-hidden className="size-7 shrink-0" />
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      isIconOnly
                      aria-label={`Remove ${repository}`}
                      aria-describedby={errorId}
                      icon={<X />}
                      onClick={() => {
                        onRemove(index);
                      }}
                    />
                  )}
                </span>
                {error === undefined ? null : <InlineError variant="field" id={errorId} title={error} />}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex min-h-(--size-control-sm) flex-wrap items-center gap-1.5">
        {subRepositories.length === 0 ? <span className="text-meta text-muted-foreground">None</span> : null}
        {isAllAdded ? (
          <Tooltip>
            {/* Focusable while off, so hover and focus say why. */}
            <TooltipTrigger render={addSubRepository} />
            <TooltipContent>Every offered repository is added.</TooltipContent>
          </Tooltip>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger render={addSubRepository} />
            <DropdownMenuContent align="start">
              {addable.map((repository) => (
                <DropdownMenuItem
                  key={repository}
                  className="font-mono text-id"
                  onClick={() => {
                    onAdd(repository);
                  }}
                >
                  {repository}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <p className="text-meta text-muted-foreground">
        Each is a new git worktree beside the main repository, for {shipName} to work in. The plugin places {shipName} only on a machine that offers every repository.
      </p>
    </div>
  );
}
