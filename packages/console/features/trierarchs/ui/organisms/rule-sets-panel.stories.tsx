import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, screen, userEvent } from 'storybook/test';
import type { GuardConfiguration } from '../../../../lib/trierarch-plugin-guard-schemas';
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
const management = { isDisabled: false, onAdd: noop, onRemove: noop, onSetFloor: noop };
const writeFailure = <GuardSaveNotice error={{ message: 'Invalid guard configuration' }} isReading={false} onReadAgain={noop} />;

const meta = {
  title: 'Trierarchs/Rule sets',
  component: RuleSetsPanel,
  args: { configuration: catalogue, management, isReading: false, onReadAgain: noop },
} satisfies Meta<typeof RuleSetsPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
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
export const UnavailableFloor: Story = { args: { configuration: { ...catalogue, sets: catalogue.sets.filter(({ name }) => name !== 'base') } } };
export const SavingFloor: Story = { args: { management: { ...management, isDisabled: true, savingFloor: 'docs-only' } } };
export const SavedFloor: Story = { args: { configuration: { ...catalogue, floor: ['base', 'docs-only'] } } };
export const FloorSaveFailure: Story = { args: { floorNotice: writeFailure } };

export const AddRepository: Story = {
  render: (args) => (
    <>
      <RuleSetsPanel {...args} />
      <AddRuleSetRepositoryDialog isPending={false} isDisabled={false} onClose={noop} onAdd={noop} />
    </>
  ),
  play: async () => {
    await expect(await screen.findByRole('radio', { name: 'Public' })).toBeChecked();
    await expect(screen.queryByLabelText('Read token')).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Private' }));
    await expect(await screen.findByLabelText('Read token')).toHaveAttribute('type', 'password');
  },
};
export const AddingRepository: Story = {
  render: () => <AddRuleSetRepositoryDialog isPending isDisabled onClose={noop} onAdd={noop} />,
};
export const AddRepositoryFailure: Story = {
  render: () => <AddRuleSetRepositoryDialog isPending={false} isDisabled={false} notice={writeFailure} onClose={noop} onAdd={noop} />,
};
export const AddedRepository: Story = {
  args: {
    configuration: {
      ...catalogue,
      repositories: [...catalogue.repositories, { repository: 'acme/other-rules', folder: 'rules/', access: 'public', readCommit: null }],
    },
  },
};
export const RemoveRepository: Story = {
  render: () => <RemoveRuleSetRepositoryDialog repository="acme/guard-rules" isPending={false} isDisabled={false} onClose={noop} onConfirm={noop} />,
};
export const RemovingRepository: Story = {
  render: () => <RemoveRuleSetRepositoryDialog repository="acme/guard-rules" isPending isDisabled onClose={noop} onConfirm={noop} />,
};
export const RemoveRepositoryFailure: Story = {
  render: () => <RemoveRuleSetRepositoryDialog repository="acme/guard-rules" isPending={false} isDisabled={false} notice={writeFailure} onClose={noop} onConfirm={noop} />,
};
export const RemovedRepository: Story = { args: { configuration: { ...catalogue, repositories: [], sets: [] } } };

export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
export const Desktop1440: Story = { parameters: { viewport: { defaultViewport: 'desktop1440' } } };
export const Desktop1920: Story = { parameters: { viewport: { defaultViewport: 'desktop1920' } } };
