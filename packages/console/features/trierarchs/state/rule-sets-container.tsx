'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Badge, Button } from '@aeolus-fleet/ui';
import { ListPage } from '../../../components/organisms/list-page';
import { useAccess } from '../../../lib/access';
import { useConsoleFrame } from '../../../lib/console-frame';
import { lazyDialog } from '../../../lib/lazy-dialog';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useTrierarchPluginConnection, useTrierarchPluginVersion } from '../../../lib/trierarch-plugin';
import { useGuardConfiguration } from '../hooks/use-guard-configuration';
import { useRuleSetsAccess } from '../hooks/use-rule-sets-access';
import type { GuardChange } from '../services/guard-configuration';
import { TrierarchTabs } from '../ui/molecules/trierarch-tabs';
import { GuardSaveNotice } from '../ui/organisms/guard-save-notice';
import { RuleSetsPanel } from '../ui/organisms/rule-sets-panel';
import { TrierarchsContainer } from './trierarchs-container';

const AddRepositoryDialog = lazyDialog(
  () => import('../ui/organisms/add-rule-set-repository-dialog').then((module) => module.AddRuleSetRepositoryDialog),
  () => true,
);
const RemoveRepositoryDialog = lazyDialog(
  () => import('../ui/organisms/remove-rule-set-repository-dialog').then((module) => module.RemoveRuleSetRepositoryDialog),
  () => true,
);

type Dialog = { kind: 'add' } | { kind: 'remove'; repository: string };

/** The Rule sets page uses the same Trierarchs chrome, with independently scoped writes. */
export function RuleSetsContainer() {
  const frame = useConsoleFrame();
  const { canManage } = useAccess();
  const { fleetId, canReadRuleSets, canChangeRuleSets } = useRuleSetsAccess();
  const connection = useTrierarchPluginConnection();
  const pluginVersion = useTrierarchPluginVersion();
  const liveFleet = useLiveFleet();
  const canRead = canReadRuleSets && connection !== 'none' && connection !== 'unknown';
  const canChange = canRead && canChangeRuleSets;
  const guard = useGuardConfiguration({ fleetId, isEnabled: canRead, canChange });
  const [dialog, setDialog] = useState<Dialog>();

  if (connection === 'none' || (fleetId !== undefined && !canReadRuleSets)) {
    return <TrierarchsContainer />;
  }

  const open = (next: Dialog) => {
    guard.resetError();
    setDialog(next);
  };
  const close = () => {
    guard.resetError();
    setDialog(undefined);
  };
  const save = async (change: GuardChange) => {
    if (await guard.save(change)) setDialog(undefined);
  };
  const onReadAgain = () => { void guard.readAgain(); };
  const isDisabled = guard.isWriteDisabled;
  const management = canChange ? {
    isDisabled,
    floorSave: guard.floorSave,
    repositoryUpdates: guard.repositoryUpdates,
    onUpdate: (repository: string) => { void guard.updateRepository(repository); },
    onAdd: () => { open({ kind: 'add' }); },
    onRemove: (repository: string) => { open({ kind: 'remove', repository }); },
    onSetFloor: (name: string, isIncluded: boolean) => { void save({ kind: 'floor', name, isIncluded }); },
  } : undefined;
  const notice = <GuardSaveNotice error={guard.error} isReading={guard.query.isFetching} onReadAgain={onReadAgain} />;
  const configuration = canRead ? guard.query.data : undefined;

  return (
    <ListPage
      {...frame}
      title="Trierarchs"
      titleMeta={pluginVersion === undefined ? undefined : <Badge variant="outline">trierarch plugin {pluginVersion}</Badge>}
      description="The rule sets a crew request can name, and the floor every request is checked against."
      live={liveFleet.live}
      primaryAction={management && (configuration?.repositories.length ?? 0) > 0 ? (
        <Button
          variant="primary"
          icon={<Plus aria-hidden />}
          disabled={isDisabled}
          onClick={management.onAdd}
          data-testid="rule-sets-add-repository"
        >
          Add repository
        </Button>
      ) : undefined}
    >
      {canRead ? <TrierarchTabs active="rule-sets" canSeeMcp={canManage} canSeeRuleSets /> : null}
      <RuleSetsPanel
        configuration={configuration}
        error={guard.query.isError ? guard.query.error.message : undefined}
        isReading={guard.query.isFetching}
        onReadAgain={onReadAgain}
        management={management}
        floorNotice={dialog === undefined ? notice : undefined}
      />
      {canChange && dialog?.kind === 'add' ? (
        <AddRepositoryDialog
          isPending={guard.action === 'add'}
          isDisabled={isDisabled}
          hasFailed={guard.error !== undefined}
          notice={notice}
          onClose={close}
          onAdd={(repository, readToken) => { void save({ kind: 'add', repository, readToken }); }}
        />
      ) : null}
      {canChange && dialog?.kind === 'remove' ? (
        <RemoveRepositoryDialog
          repository={dialog.repository}
          isPending={guard.action === 'remove'}
          isDisabled={isDisabled}
          hasFailed={guard.error !== undefined}
          notice={notice}
          onClose={close}
          onConfirm={() => { void save({ kind: 'remove', repository: dialog.repository }); }}
        />
      ) : null}
    </ListPage>
  );
}
