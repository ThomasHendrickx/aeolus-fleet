import { Input } from '@aeolus-fleet/ui';
import { useId, useState, type ReactNode } from 'react';

import {
  addableSubRepositories,
  mainRepository,
  refusedSubRepository,
  workspaceFromItem,
  workspaceItemOf,
  workspaceItemsOf,
  workspaceProblems,
  type OfferedWorkspaces,
  type RepositoryChoice,
  type WorkspaceChoice,
} from '../../lib/crew-settings-form';
import { SettingsField } from './settings-field';
import { SettingsSelect } from './settings-select';
import { SubRepositoriesField } from './sub-repositories-field';

interface WorkspaceFieldsProps {
  /** The ship the settings crew, as the placement hints name it. */
  shipName: string;
  /** What the workspace may be picked from. */
  offered: OfferedWorkspaces;
  workspace: WorkspaceChoice | undefined;
  onChange: (workspace: WorkspaceChoice | undefined) => void;
  /** Why the trierarch plugin refused the workspace: under the sub-repository it names, else under Workspace. */
  refusal?: string;
  isDisabled?: boolean;
  harness?: ReactNode;
}

/**
 * A crew's workspace as fields (docs/design/ship-repositories): Workspace,
 * for a repository its Branch beside it and its sub-repositories under it.
 * The request crew and commission dialogs and each squadron member show
 * them. A repository no machine offers, one named twice and the plugin's
 * refusal each say so under the field or row they concern.
 */
export function WorkspaceFields({ shipName, offered, workspace, onChange, refusal, isDisabled = false, harness }: WorkspaceFieldsProps) {
  const ids = { workspace: useId(), kind: useId(), branch: useId() };
  const [pickedKind, setPickedKind] = useState<'repositories' | 'folder'>('repositories');
  const kind = workspace?.kind ?? pickedKind;
  const problems = workspaceProblems(workspace, offered);
  const refusedRow = refusal === undefined ? undefined : refusedSubRepository(refusal, workspace);
  const rowErrors = problems.subRepositories.map((problem, index) => problem ?? (index === refusedRow ? refusal : undefined));
  const workspaceError = problems.main ?? (refusedRow === undefined ? refusal : undefined);
  const withSubRepositories = (subRepositories: RepositoryChoice[]) => {
    if (workspace?.kind === 'repositories') {
      onChange({ ...workspace, subRepositories });
    }
  };

  return (
    <>
      {harness === undefined ? null : <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {harness}
        <SettingsField id={ids.kind} label="Workspace">
          <SettingsSelect id={ids.kind} items={{ repositories: 'Repository', folder: 'Folder' }} value={kind} isDisabled={isDisabled} testId="crew-settings-workspace-kind" onPick={(picked) => {
            if (picked === 'repositories' || picked === 'folder') {
              setPickedKind(picked);
              onChange(picked === 'repositories' ? offered.repositories[0] === undefined ? undefined : mainRepository(offered.repositories[0]) : offered.folders[0] === undefined ? undefined : { kind: 'folder', name: offered.folders[0] });
            }
          }} />
        </SettingsField>
      </div>}
      <div className="grid grid-cols-1 gap-x-3 gap-y-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <SettingsField
          id={ids.workspace}
          label={harness === undefined ? 'Workspace' : kind === 'repositories' ? 'Repository' : 'Folder'}
          hint={workspace?.kind === 'folder' ? 'A folder is used as it is, shared by the ships in it, with no sub-repositories.' : undefined}
          error={workspaceError}
          className={workspace?.kind === 'repositories' ? undefined : 'sm:col-span-2'}
        >
          <SettingsSelect
            id={ids.workspace}
            items={harness === undefined ? workspaceItemsOf(offered, workspace) : { ...(workspace === undefined ? { '': 'Choose...' } : {}), ...workspaceItemsOf(kind === 'repositories' ? { repositories: offered.repositories, folders: [] } : { repositories: [], folders: offered.folders }, workspace) }}
            value={workspaceItemOf(workspace)}
            isDisabled={isDisabled}
            testId="crew-settings-workspace"
            onPick={(picked) => {
              onChange(workspaceFromItem(picked, workspace));
            }}
          />
        </SettingsField>
        {workspace?.kind === 'repositories' ? (
          <SettingsField id={ids.branch} label="Branch" isOptional>
            <Input
              id={ids.branch}
              isMono
              placeholder="Default branch"
              disabled={isDisabled}
              data-testid="crew-settings-branch"
              value={workspace.main.ref}
              onChange={(event) => {
                onChange({ ...workspace, main: { ...workspace.main, ref: event.target.value } });
              }}
            />
          </SettingsField>
        ) : null}
      </div>
      {workspace?.kind === 'repositories' ? (
        <SubRepositoriesField
          shipName={shipName}
          subRepositories={workspace.subRepositories}
          addable={addableSubRepositories(workspace, offered)}
          errors={rowErrors}
          isDisabled={isDisabled}
          onAdd={(repository) => {
            withSubRepositories([...workspace.subRepositories, { repository, ref: '' }]);
          }}
          onBranchChange={(changed, ref) => {
            withSubRepositories(workspace.subRepositories.map((each, index) => (index === changed ? { ...each, ref } : each)));
          }}
          onRemove={(removed) => {
            withSubRepositories(workspace.subRepositories.filter((_, index) => index !== removed));
          }}
        />
      ) : null}
    </>
  );
}
