import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, screen, userEvent } from 'storybook/test';

import { JOINED } from '../../../../lib/fixtures/machines.fixtures';
import { JoinMachineDialog } from './join-machine-dialog';

const meta = {
  title: 'Organisms/JoinMachineDialog',
  component: JoinMachineDialog,
  parameters: { layout: 'fullscreen' },
  args: { takenNames: ['trierarch-mac'], isOpen: true, onOpenChange: () => undefined, isPending: false, onSubmit: fn() },
  decorators: [
    (Story) => (
      <div className="min-h-160">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof JoinMachineDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Name: Story = {};
export const Joining: Story = { args: { isPending: true } };
export const Failed: Story = { args: { error: 'A ship named trierarch-mac exists.' } };
export const Joined: Story = { args: { joined: JOINED } };

async function named() {
  await userEvent.type(await screen.findByTestId('join-machine-name'), 'trierarch-new');
}

async function filled() {
  await named();
  await userEvent.click(screen.getByTestId('join-machine-claude-code-unattended'));
  await userEvent.click(screen.getByTestId('join-machine-codex'));
  await userEvent.click(screen.getByTestId('join-machine-repositories-list'));
  await userEvent.type(screen.getByTestId('join-machine-repository-1'), '~/code/web');
  await userEvent.click(screen.getByTestId('join-machine-add-field'));
  await userEvent.type(screen.getByTestId('join-machine-repository-2'), '~/code/api');
  await userEvent.click(screen.getByTestId('join-machine-add-field'));
  await userEvent.type(screen.getByTestId('join-machine-repository-3'), 'git@github.com:acme/docs.git');
}

export const AfterEmpty: Story = {
  play: async () => {
    // Given the name step opens, when nothing is filled, then the machine asks for both options.
    await expect(await screen.findByTestId('join-machine-repositories-ask')).toBeChecked();
    await expect(screen.getByTestId('join-machine-claude-code')).not.toBeChecked();
    await expect(screen.getByTestId('join-machine-submit')).toBeDisabled();
  },
};
export const AfterNamed: Story = {
  play: async ({ args }) => {
    // Given a free name, when joined with no options, then only the name goes to the plugin.
    await named();
    await userEvent.click(screen.getByTestId('join-machine-submit'));
    await expect(args.onSubmit).toHaveBeenCalledWith({ name: 'trierarch-new' });
  },
};
export const AfterTaken: Story = {
  play: async () => {
    await userEvent.type(await screen.findByTestId('join-machine-name'), 'trierarch-mac');
    await expect(screen.getByTestId('join-machine-submit')).toBeDisabled();
  },
};
export const AfterFilled: Story = {
  play: async ({ args }) => {
    // Given harnesses and separate paths and a git URL, when joined, then the plugin receives the options, not a line.
    await filled();
    await userEvent.click(screen.getByTestId('join-machine-submit'));
    await expect(args.onSubmit).toHaveBeenCalledWith({ name: 'trierarch-new', harnesses: ['claude-code', 'codex'], unattended: ['claude-code'], repositories: { kind: 'list', entries: ['~/code/web', '~/code/api', 'git@github.com:acme/docs.git'] } });
  },
};
export const AfterFieldAdded: Story = {
  play: async ({ args }) => {
    // Given filled rows, when Add field is pressed, then a removable empty row appears and is omitted on join.
    await filled();
    await userEvent.click(screen.getByTestId('join-machine-add-field'));
    await expect(screen.getByTestId('join-machine-repository-4')).toHaveValue('');
    await expect(screen.getByTestId('join-machine-repository-4')).toHaveAttribute('placeholder', '~/code/web or git@github.com:acme/docs.git');
    await userEvent.click(screen.getByTestId('join-machine-submit'));
    await expect(args.onSubmit).toHaveBeenCalledWith({ name: 'trierarch-new', harnesses: ['claude-code', 'codex'], unattended: ['claude-code'], repositories: { kind: 'list', entries: ['~/code/web', '~/code/api', 'git@github.com:acme/docs.git'] } });
  },
};
export const AfterUnattendedTicked: Story = {
  play: async () => {
    // Given Claude Code is off, when its without-asking is ticked, then its harness is ticked too.
    await named();
    await userEvent.click(screen.getByTestId('join-machine-codex-unattended'));
    await expect(screen.getByTestId('join-machine-codex')).toBeChecked();
    await userEvent.click(screen.getByTestId('join-machine-codex'));
    await expect(screen.getByTestId('join-machine-codex-unattended')).not.toBeChecked();
    await userEvent.click(screen.getByTestId('join-machine-claude-code-unattended'));
    await expect(screen.getByTestId('join-machine-claude-code')).toBeChecked();
  },
};
export const AfterHarnessUnticked: Story = {
  play: async ({ args }) => {
    // Given Claude Code runs without asking, when the harness is unticked, then without-asking is unticked too.
    await filled();
    await userEvent.click(screen.getByTestId('join-machine-claude-code'));
    await expect(screen.getByTestId('join-machine-claude-code-unattended')).not.toBeChecked();
    await userEvent.click(screen.getByTestId('join-machine-submit'));
    await expect(args.onSubmit).toHaveBeenCalledWith({ name: 'trierarch-new', harnesses: ['codex'], repositories: { kind: 'list', entries: ['~/code/web', '~/code/api', 'git@github.com:acme/docs.git'] } });
  },
};
export const AfterFolder: Story = {
  play: async ({ args }) => {
    await named();
    await userEvent.click(screen.getByTestId('join-machine-codex'));
    await userEvent.click(screen.getByTestId('join-machine-repositories-folder'));
    await userEvent.type(screen.getByTestId('join-machine-folder'), '~/code');
    await userEvent.click(screen.getByTestId('join-machine-submit'));
    await expect(args.onSubmit).toHaveBeenCalledWith({ name: 'trierarch-new', harnesses: ['codex'], repositories: { kind: 'folder', path: '~/code' } });
  },
};
export const AfterNoRepositories: Story = {
  play: async ({ args }) => {
    await named();
    await userEvent.click(screen.getByTestId('join-machine-copilot'));
    await userEvent.click(screen.getByTestId('join-machine-repositories-none'));
    await userEvent.click(screen.getByTestId('join-machine-submit'));
    await expect(args.onSubmit).toHaveBeenCalledWith({ name: 'trierarch-new', harnesses: ['copilot'], repositories: { kind: 'none' } });
  },
};
export const AfterInvalidList: Story = {
  play: async () => {
    // Given paths in separate fields, when one lacks / or ~ and is no git URL, then its own error blocks joining.
    await filled();
    await userEvent.click(screen.getByTestId('join-machine-remove-3'));
    await userEvent.clear(screen.getByTestId('join-machine-repository-2'));
    await userEvent.type(screen.getByTestId('join-machine-repository-2'), 'code/api');
    await expect(screen.getByText('code/api is no path from / or ~, and no git URL.')).toBeVisible();
    await expect(screen.getByTestId('join-machine-repository-2')).toHaveAttribute('aria-invalid', 'true');
    await expect(screen.getByTestId('join-machine-repository-1')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(screen.getByTestId('join-machine-submit')).toBeDisabled();
  },
};

/** A press shows the mutation pending immediately, with the filled form kept and all edits off. */
export const PressShowsPending: Story = {
  render: function Render(args) {
    const [isPending, setIsPending] = useState(false);
    return <JoinMachineDialog {...args} isPending={isPending} onSubmit={() => { setIsPending(true); }} />;
  },
  play: async () => {
    // Given a filled form, when Join machine is pressed, then it shows Joining before any answer.
    await filled();
    await userEvent.click(screen.getByTestId('join-machine-submit'));
    await expect(screen.getByTestId('join-machine-submit')).toHaveTextContent('Joining');
    await expect(screen.getByTestId('join-machine-submit')).toHaveAttribute('aria-busy', 'true');
    await expect(screen.getByTestId('join-machine-name')).toBeDisabled();
    await expect(screen.getByTestId('join-machine-claude-code')).toHaveAttribute('data-disabled');
    await expect(screen.getByTestId('join-machine-repository-1')).toBeDisabled();
    await expect(screen.getByTestId('join-machine-repository-1')).toHaveValue('~/code/web');
    await expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  },
};
