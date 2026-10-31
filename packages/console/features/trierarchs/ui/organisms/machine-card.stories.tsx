import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { ALIVE_MACHINE, KEY_MACHINE, NEW_MACHINE, NO_KEY_MACHINE, NOT_OFFERED_MACHINE, NOW, OUT_OF_CREDIT_MACHINE, REFUSED_MACHINE, SILENT_MACHINE, SPOT_HARNESSES, SPOTS } from '../../../../lib/fixtures/machines.fixtures';
import { MachineCard } from './machine-card';

const meta = {
  title: 'Organisms/MachineCard',
  component: MachineCard,
  args: { machine: ALIVE_MACHINE, spots: SPOTS, location: { kind: 'DEVICE', description: 'Mac mini' }, now: NOW },
} satisfies Meta<typeof MachineCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Alive: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('machine-card-usage')).toHaveAttribute('href', `/usage?machine=${ALIVE_MACHINE.shipId}`);
  },
};

/** A flag its trierarch reports as risky is marked; the others show plainly. */
export const RiskyFlag: Story = {
  play: async ({ canvasElement }) => {
    const risky = within(canvasElement).getAllByTestId('machine-risky-flag');
    await expect(risky.map((flag) => flag.textContent)).toEqual(['--dangerously-skip-permissions (risky)']);
  },
};
/** Each harness with the version its trierarch detected and when its models were last confirmed (#365). */
export const DetectedVersions: Story = {
  play: async ({ canvasElement }) => {
    const card = within(canvasElement);
    await expect(card.getByText('2.1.293 · models confirmed 3 h ago')).toBeVisible();
    await expect(card.getByText('0.160.1 · no model confirmed')).toBeVisible();
  },
};
/** For a session that may join a machine, a new setup line under whether it answers (#1239); the rest of the card as it is. */
export const NewSetupLine: Story = {
  args: { onNewSetupLine: () => undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('machine-card-new-setup-line')).toHaveTextContent('New setup line');
  },
};
export const NotAnswering: Story = { args: { machine: SILENT_MACHINE, spots: SPOTS.slice(0, 2), location: { kind: 'DEVICE', description: 'MacBook' } } };
export const NotStarted: Story = { args: { machine: NEW_MACHINE, spots: [], location: null } };

/** A harness its trierarch cannot serve is told above the ones it offers, with why and that it clears itself (#1215). */
export const HarnessNotOffered: Story = {
  args: { machine: NOT_OFFERED_MACHINE },
  play: async ({ canvasElement }) => {
    const line = within(canvasElement).getByTestId('not-offered');
    await expect(line).toHaveTextContent('Codex not offered');
    await expect(line).toHaveTextContent('its aeolus plugin is not installed (run aeolus-trierarch upgrade).');
    await expect(line).toHaveTextContent('Clears itself once the plugin is back.');
  },
};

/** Each harness's login line: its default, its ships on the other login, and what they spent on the key (aeolus-fleet-trierarch's api keys design, K12). */
export const KeyReady: Story = {
  args: { machine: KEY_MACHINE, ships: SPOT_HARNESSES },
  play: async ({ canvasElement }) => {
    const lines = within(canvasElement).getAllByTestId('machine-login-line');
    await expect(lines.map((line) => line.textContent)).toEqual(['loginAPI key·2 on Subscription·$41.20 on key', 'loginSubscription·1 on API key·$3.10 on key']);
    await expect(within(canvasElement).queryByTestId('machine-key-chip')).toBeNull();
  },
};
/** Claude Code's key out of credit: a chip under its login line, and how many ships wait (K9, K12). */
export const KeyOutOfCredit: Story = {
  args: { machine: OUT_OF_CREDIT_MACHINE, ships: SPOT_HARNESSES },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement);
    await expect(card.getByTestId('machine-key-chip')).toHaveTextContent('Out of credit');
    await expect(card.getByTestId('machine-ships-wait')).toHaveTextContent('3 ships wait');
  },
};
/** Claude Code's key refused by its vendor (K10). */
export const KeyRefused: Story = {
  args: { machine: REFUSED_MACHINE, ships: SPOT_HARNESSES },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('machine-key-chip')).toHaveTextContent('Refused');
  },
};
/** Claude Code with no API key on the computer. */
export const NoKey: Story = {
  args: { machine: NO_KEY_MACHINE, ships: SPOT_HARNESSES },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('machine-key-chip')).toHaveTextContent('No key');
  },
};
