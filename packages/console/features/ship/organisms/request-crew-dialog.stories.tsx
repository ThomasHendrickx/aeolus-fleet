import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { MACHINE_LABELS, MACHINE_VALUES, OFFERS, SETTINGS } from '../../../lib/fixtures/machines.fixtures';
import { RequestCrewDialog } from './request-crew-dialog';

const meta = {
  title: 'Organisms/RequestCrewDialog',
  component: RequestCrewDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    shipName: 'triage-bot',
    mode: 'request',
    state: 'ready',
    offers: OFFERS,
    squadrons: ['hemma-feature-63p5sx'],
    machineLabels: MACHINE_LABELS,
    isPending: false,
    isOpen: true,
    onOpenChange: () => undefined,
    onSettingsChange: () => undefined,
    onSubmit: () => undefined,
    onRetry: () => undefined,
  },
  decorators: [
    (Story) => (
      <div className="min-h-200">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RequestCrewDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Form: Story = { args: { check: { kind: 'fits' } } };
export const Loading: Story = { args: { state: 'loading' } };
export const Unreachable: Story = { args: { state: 'unreachable' } };
export const NoRoom: Story = { args: { check: { kind: 'noRoom', reason: 'no trierarch with room: all 1 that fit are full' } } };
export const Refused: Story = {
  args: { check: { kind: 'refused', field: 'workspace', reason: 'no trierarch offering claude-code has repository hemma' }, refusedAt: new Date('2026-10-07T13:32:05Z') },
};
export const NoMachines: Story = { args: { offers: [] } };
export const Requesting: Story = { args: { check: { kind: 'fits' }, isPending: true } };
export const Failed: Story = { args: { check: { kind: 'fits' }, error: 'The server did not answer.' } };
export const Edit: Story = { args: { mode: 'edit', heldSettings: SETTINGS, check: { kind: 'fits' } } };
/** Two machine labels that trierarch-mac and trierarch-macbook carry (canvas LbRequestTwo). */
export const MachineLabels: Story = { args: { mode: 'edit', heldSettings: { ...SETTINGS, machineLabels: [MACHINE_VALUES.macos, MACHINE_VALUES.arm64] }, check: { kind: 'fits' } } };
/** Labels no machine carries: the request can still be made and waits (canvas LbRequestNoMatch). */
export const MachineLabelsNoMatch: Story = {
  args: { mode: 'edit', heldSettings: { ...SETTINGS, machineLabels: [MACHINE_VALUES.linux, MACHINE_VALUES.arm64] }, check: { kind: 'noRoom', reason: 'no machine matches its labels' } },
};
