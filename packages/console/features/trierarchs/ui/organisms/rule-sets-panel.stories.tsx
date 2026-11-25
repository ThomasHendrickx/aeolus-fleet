import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, screen, userEvent } from 'storybook/test';
import type { GuardConfiguration } from '../../../../lib/trierarch-plugin-guard-schemas';
import type { RepositoryUpdate } from '../../services/guard-configuration';
import { AddRuleSetRepositoryDialog } from './add-rule-set-repository-dialog';
import { GuardSaveNotice } from './guard-save-notice';
import { RemoveRuleSetRepositoryDialog } from './remove-rule-set-repository-dialog';
import { RuleSetsPanel } from './rule-sets-panel';

const catalogue: GuardConfiguration = {
  version: 1,
  repositories: [{ repository: 'acme/guard-rules', folder: 'rules/', access: 'private', readCommit: '8d41e07a1234567890' }],
  sets: [
    { name: 'base', repository: 'acme/guard-rules', commit: '8d41e07a1234567890', file: 'rules/base.yaml', rulesCount: 6 },
    { name: 'docs-only', repository: 'acme/guard-rules', commit: '8d41e07a1234567890', file: 'rules/docs-only.yaml', rulesCount: 4 },
    { name: 'no-push', repository: 'acme/guard-rules', commit: '8d41e07a1234567890', file: 'rules/no-push.yaml', rulesCount: 3 },
  ],
  floor: ['base'],
  errors: [],
  conflicts: [],
};
const noop = () => undefined;
const management = { isDisabled: false, onUpdate: noop, onAdd: noop, onRemove: noop, onSetFloor: noop };
const writeFailure = <GuardSaveNotice error={{ message: 'Invalid guard configuration' }} isReading={false} onReadAgain={noop} />;

const meta = {
  title: 'Trierarchs/Rule sets',
  component: RuleSetsPanel,
  args: { configuration: catalogue, management, isReading: false, onReadAgain: noop },
} satisfies Meta<typeof RuleSetsPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

function withRepositoryUpdate(update: RepositoryUpdate) {
  return { ...management, repositoryUpdates: new Map([['acme/guard-rules', update]]) };
}

export const UpdatingRepository: Story = {
  args: { management: withRepositoryUpdate({ state: 'pending' }) },
};

const updatedCommit = 'a73c19e1234567890';
export const UpdatedRepository: Story = {
  args: {
    configuration: {
      ...catalogue,
      repositories: catalogue.repositories.map((repository) => ({ ...repository, readCommit: updatedCommit })),
      sets: catalogue.sets.map((set) => ({ ...set, commit: updatedCommit })),
    },
    management: withRepositoryUpdate({ state: 'success' }),
  },
};

export const RepositoryUpdateFailure: Story = {
  args: {
    management: withRepositoryUpdate({ state: 'failure', reason: 'GitHub did not respond.', hasStoredCopy: true }),
  },
};
export const Empty: Story = { args: { configuration: { ...catalogue, repositories: [], sets: [], floor: [] } } };
export const Loading: Story = { args: { configuration: undefined, isReading: true } };
export const ReadFailure: Story = { args: { configuration: undefined, error: 'The trierarch plugin did not answer with its rule sets.' } };
export const ReadOnly: Story = { args: { management: undefined } };
export const CatalogueErrors: Story = {
  args: {
    configuration: {
      ...catalogue,
      repositories: [...catalogue.repositories, { repository: 'acme/other-rules', folder: 'rules/', access: 'public', readCommit: null }],
      sets: catalogue.sets.filter(({ name }) => name === 'base'),
      errors: [{ repository: 'acme/guard-rules', file: 'rules/docs-only.yaml', reason: 'Expected a command name' }],
      conflicts: [{ name: 'no-push', repositories: ['acme/guard-rules', 'acme/other-rules'] }],
    },
  },
};
const unavailableFloor = { ...catalogue, sets: catalogue.sets.filter(({ name }) => name !== 'base') };
const floorSwitch = () => screen.getByRole('switch', { name: 'Floor for docs-only' });
const clearFloor = () => screen.getByRole('button', { name: 'Clear base from the floor' });

function PendingFloorOnPress({ configuration }: { configuration: GuardConfiguration }) {
  const [saving, setSaving] = useState<string>();
  return (
    <RuleSetsPanel
      {...meta.args}
      configuration={configuration}
      management={{ ...management, isDisabled: saving !== undefined, floorSave: saving === undefined ? undefined : { name: saving, state: 'pending' }, onSetFloor: setSaving }}
    />
  );
}

export const Floor: Story = {
  play: async () => { await expect(floorSwitch()).toHaveAttribute('data-state', 'idle'); },
};
export const SavingFloor: Story = {
  render: () => <PendingFloorOnPress configuration={catalogue} />,
  play: async () => {
    await expect(floorSwitch()).toHaveAttribute('data-state', 'idle');
    await userEvent.click(floorSwitch());
    await expect(floorSwitch()).toHaveAttribute('data-state', 'pending');
    await expect(floorSwitch()).toHaveAttribute('aria-disabled', 'true');
    await expect(screen.getByRole('status')).toHaveTextContent('Saving');
  },
};
export const SavedFloor: Story = {
  args: { configuration: { ...catalogue, floor: ['base', 'docs-only'] }, management: { ...management, floorSave: { name: 'docs-only', state: 'success' } } },
  play: async () => {
    await expect(floorSwitch()).toHaveAttribute('data-state', 'success');
    await expect(floorSwitch()).toBeChecked();
  },
};
export const FloorSaveFailure: Story = {
  args: { floorNotice: writeFailure, management: { ...management, floorSave: { name: 'docs-only', state: 'failure' } } },
  play: async () => {
    await expect(floorSwitch()).toHaveAttribute('data-state', 'failure');
    await expect(floorSwitch()).not.toBeChecked();
    await expect(screen.getByRole('alert')).toHaveTextContent('Invalid guard configuration');
  },
};

export const UnavailableFloor: Story = {
  args: { configuration: unavailableFloor },
  play: async () => { await expect(clearFloor()).toHaveAttribute('data-state', 'idle'); },
};
export const ClearingFloor: Story = {
  render: () => <PendingFloorOnPress configuration={unavailableFloor} />,
  play: async () => {
    await expect(clearFloor()).toHaveAttribute('data-state', 'idle');
    await userEvent.click(clearFloor());
    await expect(clearFloor()).toHaveAttribute('data-state', 'pending');
    await expect(clearFloor()).toHaveAttribute('aria-disabled', 'true');
    await expect(clearFloor()).toHaveTextContent('Clearing');
  },
};
export const ClearedFloor: Story = {
  args: { configuration: { ...unavailableFloor, floor: [] }, management: { ...management, floorSave: { name: 'base', state: 'success' } } },
  play: async () => {
    await expect(screen.getByRole('switch', { name: 'Floor for docs-only' })).toBeVisible();
    await expect(screen.queryByRole('button', { name: 'Clear base from the floor' })).not.toBeInTheDocument();
  },
};
export const ClearFloorFailure: Story = {
  args: { configuration: unavailableFloor, floorNotice: writeFailure, management: { ...management, floorSave: { name: 'base', state: 'failure' } } },
  play: async () => {
    await expect(clearFloor()).toHaveAttribute('data-state', 'failure');
    await expect(clearFloor()).toBeEnabled();
    await expect(screen.getByRole('alert')).toHaveTextContent('Invalid guard configuration');
  },
};

export const AddRepository: Story = {
  render: (args) => (
    <>
      <RuleSetsPanel {...args} />
      <AddRuleSetRepositoryDialog isPending={false} isDisabled={false} onClose={noop} onAdd={noop} />
    </>
  ),
  play: async () => {
    await expect(await screen.findByRole('dialog')).toHaveAttribute('data-state', 'idle');
    await expect(await screen.findByRole('radio', { name: 'Public' })).toBeChecked();
    await expect(screen.queryByLabelText('Read token')).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Private' }));
    await expect(await screen.findByLabelText('Read token')).toHaveAttribute('type', 'password');
  },
};
export const AddingRepository: Story = {
  render: () => <AddRuleSetRepositoryDialog isPending isDisabled onClose={noop} onAdd={noop} />,
  play: async () => { await expect(await screen.findByRole('dialog')).toHaveAttribute('data-state', 'pending'); },
};
export const AddRepositoryFailure: Story = {
  render: () => <AddRuleSetRepositoryDialog isPending={false} isDisabled={false} hasFailed notice={writeFailure} onClose={noop} onAdd={noop} />,
  play: async () => { await expect(await screen.findByRole('dialog')).toHaveAttribute('data-state', 'failure'); },
};
export const AddedRepository: Story = {
  args: {
    configuration: {
      ...catalogue,
      repositories: [...catalogue.repositories, { repository: 'acme/other-rules', folder: 'rules/', access: 'public', readCommit: null }],
    },
  },
};
function PendingRemovalOnPress() {
  const [isPending, setPending] = useState(false);
  return <RemoveRuleSetRepositoryDialog repository="acme/guard-rules" isPending={isPending} isDisabled={isPending} onClose={noop} onConfirm={() => { setPending(true); }} />;
}

export const RemoveRepository: Story = {
  render: () => <RemoveRuleSetRepositoryDialog repository="acme/guard-rules" isPending={false} isDisabled={false} onClose={noop} onConfirm={noop} />,
  play: async () => { await expect(await screen.findByRole('alertdialog')).toHaveAttribute('data-state', 'idle'); },
};
export const RemovingRepository: Story = {
  render: () => <PendingRemovalOnPress />,
  play: async () => {
    const dialog = await screen.findByRole('alertdialog');
    await expect(dialog).toHaveAttribute('data-state', 'idle');
    const confirm = screen.getByRole('button', { name: 'Remove repository' });
    await userEvent.click(confirm);
    await expect(dialog).toHaveAttribute('data-state', 'pending');
    await expect(confirm).toHaveAttribute('aria-disabled', 'true');
    await expect(confirm).toHaveTextContent('Removing');
  },
};
export const RemoveRepositoryFailure: Story = {
  render: () => <RemoveRuleSetRepositoryDialog repository="acme/guard-rules" isPending={false} isDisabled={false} hasFailed notice={writeFailure} onClose={noop} onConfirm={noop} />,
  play: async () => {
    await expect(await screen.findByRole('alertdialog')).toHaveAttribute('data-state', 'failure');
    await expect(screen.getByRole('alert')).toHaveTextContent('Invalid guard configuration');
  },
};
export const RemovedRepository: Story = {
  args: { configuration: { ...catalogue, repositories: [], sets: [] } },
  play: async () => {
    await expect(screen.getByText('No rule set repositories')).toBeVisible();
    await expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  },
};

export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
export const Desktop1440: Story = { parameters: { viewport: { defaultViewport: 'desktop1440' } } };
export const Desktop1920: Story = { parameters: { viewport: { defaultViewport: 'desktop1920' } } };
