import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { LocationTag } from './location-tag';

const meta = {
  title: 'Molecules/LocationTag',
  component: LocationTag,
} satisfies Meta<typeof LocationTag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Device: Story = { args: { kind: 'DEVICE' } };
export const Cloud: Story = { args: { kind: 'CLOUD' } };
export const Server: Story = { args: { kind: 'SERVER' } };
export const Other: Story = { args: { kind: 'OTHER', description: 'CI runner' } };
export const NotCrewed: Story = { args: { kind: null } };
export const Compact: Story = { args: { kind: 'OTHER', description: 'CI runner', isCompact: true } };
export const Phone: Story = { args: { kind: 'OTHER', description: 'CI runner', size: 'sm' } };
export const ClaudeCodeOnDevice: Story = { args: { kind: 'DEVICE', description: 'Mac mini', harness: 'claude-code', size: 'sm' } };
export const CodexInCloud: Story = { args: { kind: 'CLOUD', harness: 'codex', size: 'sm' } };
export const ChatSession: Story = { args: { kind: 'CLOUD', harness: 'claude-chat', size: 'sm' } };
export const Bot: Story = { args: { kind: 'SERVER', harness: 'grokbot', size: 'sm' } };
export const ArgoConsole: Story = { args: { kind: 'OTHER', description: 'Mac · Chrome', harness: 'console', size: 'sm' } };
export const UnknownHarness: Story = { args: { kind: 'OTHER', description: 'CI runner', harness: 'github-actions', size: 'sm' } };
