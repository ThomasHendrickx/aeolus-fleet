import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { createIdGenerator } from '@aeolus-fleet/common';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import type { Harbour, HarbourGroupKind, HarbourState, HarbourTile } from '../../services/harbour';
import { HarbourView } from './harbour-view';

const newId = createIdGenerator();

function tile(name: string, { state, note = null }: { state: HarbourState; note?: string | null }): HarbourTile {
  return { id: newId('ship'), name, state, note };
}

function group(kind: HarbourGroupKind, tiles: HarbourTile[]): Harbour['groups'][number] {
  return { kind, tiles };
}

/** The mockup's fleet (docs/design/fleet-overview): 15 ships, 7 working, 4 idle, 2 waiting, 2 with an alert. */
const MOCKUP_FLEET: Harbour = {
  counts: { ships: 15, alert: 2, waiting: 2, working: 7, idle: 4 },
  groups: [
    group('people', [tile('argo', { state: 'working', note: 'Answering 2 questions' }), tile('ada', { state: 'idle', note: 'Signed in, nothing open' })]),
    group('agents', [
      tile('reviewer', { state: 'alert' }),
      tile('builder-gateway', { state: 'waiting', note: 'Blocked: waiting for release 0.35.0' }),
      tile('walker-2', { state: 'waiting' }),
      tile('orchestrator-1', { state: 'working', note: 'Splitting #1441 into tasks' }),
      tile('builder-core', { state: 'working', note: 'Slice U3: the ui package' }),
      tile('walker-1', { state: 'working', note: 'Walking PR #1440 on staging' }),
      tile('builder-ui', { state: 'idle', note: 'Nothing in the inbox' }),
    ]),
    group('plugins', [tile('squadrons', { state: 'working' }), tile('trierarch', { state: 'working' }), tile('networking', { state: 'idle', note: 'Rules v7 applied' })]),
    group('gateway', [tile('sentry', { state: 'alert' }), tile('linear', { state: 'working' }), tile('github', { state: 'idle' })]),
  ],
};

const meta = {
  title: 'Organisms/HarbourView',
  component: HarbourView,
  args: { harbour: MOCKUP_FLEET, state: 'ready', onRetry: () => undefined },
  decorators: [
    (Story) => (
      <div className="max-w-185">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HarbourView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Dark: Story = { globals: { theme: 'dark' } };

export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };

export const PhoneDark: Story = { globals: { viewport: { value: 'mobile1' }, theme: 'dark' } };

/** A long name truncates in its tile. */
export const LongName: Story = {
  args: { harbour: { counts: { ships: 1, alert: 0, waiting: 0, working: 1, idle: 0 }, groups: [group('agents', [tile('builder-for-the-gateway-and-its-proxy-ships', { state: 'working' })])] } },
};

export const Loading: Story = { args: { harbour: undefined, state: 'loading' } };

export const Failed: Story = { args: { harbour: undefined, state: 'error' } };

/** A tap on a tile shows what the ship is doing, and the way to it. */
export const WhatAShipIsDoing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'orchestrator-1: Working' }));

    const doing = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(doing.getByText('Splitting #1441 into tasks')).toBeVisible());
    await expect(doing.getByRole('link', { name: 'Open ship' })).toBeVisible();
  },
};

/** A ship that has not reported says so. */
export const NoReportYet: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'walker-2: Waiting' }));

    await waitFor(() => expect(within(canvasElement.ownerDocument.body).getByText('No report yet')).toBeVisible());
  },
};
