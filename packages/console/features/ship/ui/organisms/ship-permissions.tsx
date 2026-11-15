'use client';

import { Badge, Button, InlineError, Skeleton } from '@aeolus-fleet/ui';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { PermissionChoices } from '../../../../components/molecules/permission-choices';

interface Permission { scope: string; description: string; isLocked?: boolean }

/** Held permissions and their inline editor, preserving inputs through a refused save. */
export function ShipPermissions({ shipName, scopes, choices, canChange, isPending, error, readError, isRetrying, onRetry, onSave }: {
  shipName: string;
  scopes: readonly string[];
  choices: readonly Permission[] | undefined;
  canChange: boolean;
  isPending: boolean;
  error?: string;
  readError?: string;
  isRetrying?: boolean;
  onRetry?: () => void;
  onSave: (change: { grant: string[]; revoke: string[] }) => void;
}) {
  const [isEditing, setIsEditing] = useState(isPending);
  // Store only the person's changes; untouched permissions always come from the fleet.
  const { control, setValue, reset, handleSubmit } = useForm<{ grant: string[]; revoke: string[] }>({ defaultValues: { grant: [], revoke: [] } });
  const { grant = [], revoke = [] } = useWatch({ control });
  const picked = [...scopes.filter((scope) => !revoke.includes(scope)), ...grant.filter((scope) => !scopes.includes(scope))];
  const [query, setQuery] = useState('');
  const listed = choices?.map((choice) => ({ ...choice, hint: choice.isLocked ? 'You cannot change this permission.' : grant.includes(choice.scope) ? 'Will add' : revoke.includes(choice.scope) ? 'Will remove' : undefined }));
  return <section className="flex w-full max-w-200 flex-col gap-3" aria-label="Permissions" data-testid="ship-permissions">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-section font-semibold">Permissions</h2>
      {!canChange ? null : isEditing ? <span className="text-meta text-muted-foreground">Editing permissions</span> : <Button onClick={() => { reset(); setQuery(''); setIsEditing(true); }} data-testid="ship-permissions-change">Change permissions</Button>}
    </div>
    <div className="flex flex-wrap gap-1.5">{scopes.map((scope) => <Badge key={scope} variant="type" data-testid="ship-fleet-scope">{scope}</Badge>)}</div>
    {!isEditing ? null : <form onSubmit={(event) => { void handleSubmit((difference) => { onSave(difference); })(event); }} className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-3"><h3 className="text-section font-semibold">Change permissions</h3><span className="text-meta text-muted-foreground">{shipName}</span></div>
      <p className="text-meta text-muted-foreground">Add or remove permissions you may grant.</p>
      {readError !== undefined || isRetrying === true ? <InlineError title="Couldn’t read permissions" description={readError} onRetry={onRetry} isRetrying={isRetrying} /> : listed === undefined ? <Skeleton className="h-40 w-full" /> : <PermissionChoices isExpanded choices={listed} picked={picked} onPick={(next) => { setValue('grant', next.filter((scope) => !scopes.includes(scope))); setValue('revoke', scopes.filter((scope) => !next.includes(scope))); }} query={query} onQueryChange={setQuery} isDisabled={isPending} />}
      {error === undefined ? null : <InlineError title="Permissions not saved" description={error} />}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <p className="mr-auto text-meta text-muted-foreground" role="status">{grant.length} permission{grant.length === 1 ? '' : 's'} added · {revoke.length} removed</p>
        <Button type="button" disabled={isPending} onClick={() => { reset(); setIsEditing(false); }} data-testid="ship-permissions-cancel">Cancel</Button>
        <Button type="submit" variant="primary" isLoading={isPending} disabled={choices === undefined || readError !== undefined || (grant.length === 0 && revoke.length === 0)} data-testid="ship-permissions-save">{isPending ? 'Saving permissions' : 'Save permissions'}</Button>
      </div>
    </form>}
  </section>;
}
