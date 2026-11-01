import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { createIdGenerator } from '@aeolus-fleet/common';
import { expect, within } from 'storybook/test';

import type { HarbourState } from '@aeolus-fleet/common/rules';

import type { Harbour, HarbourGroupKind, HarbourTile } from '../../services/harbour';
import { HarbourView } from './harbour-view';

const newId = createIdGenerator();

function tile(name: string, { state, note = null, kind = 'agent' }: { state: HarbourState; note?: string | null; kind?: HarbourTile['kind'] }): HarbourTile {
  return { id: newId('ship'), name, kind, state, note };
}

function group(kind: HarbourGroupKind, tiles: HarbourTile[]): Harbour['groups'][number] {
  return { kind, tiles };
}

/** The mockup's fleet (docs/design/fleet-overview): 15 ships, 7 working, 4 idle, 2 waiting, 2 with an alert. */
const MOCKUP_FLEET: Harbour = {
  counts: { ships: 15, alert: 2, waiting: 2, working: 7, idle: 4 },
  groups: [
    group('people', [tile('argo', { state: 'working', note: 'Answering 2 questions', kind: 'operator' }), tile('ada', { state: 'idle', note: 'Signed in, nothing open', kind: 'person' })]),
    group('agents', [
      tile('reviewer', { state: 'alert' }),
      tile('builder-gateway', { state: 'waiting', note: 'Blocked: waiting for release 0.35.0' }),
      tile('walker-2', { state: 'waiting' }),
      tile('orchestrator-1', { state: 'working', note: 'Splitting #1441 into tasks' }),
      tile('builder-core', { state: 'working', note: 'Slice U3: the ui package' }),
      tile('walker-1', { state: 'working', note: 'Walking PR #1440 on staging' }),
      tile('builder-ui', { state: 'idle', note: 'Nothing in the inbox' }),
    ]),
    group('plugins', [tile('squadrons', { kind: 'plugin', state: 'working' }), tile('trierarch', { kind: 'plugin', state: 'working' }), tile('networking', { kind: 'plugin', state: 'idle', note: 'Rules v7 applied' })]),
    group('gateway', [tile('sentry', { kind: 'app', state: 'alert' }), tile('linear', { kind: 'app', state: 'working' }), tile('github', { kind: 'app', state: 'idle' })]),
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

/** What a ship is doing shows in its tile's title, as the mockup's markup has it; its state where it has not reported. */
export const WhatAShipIsDoing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTitle('orchestrator-1: Splitting #1441 into tasks')).toHaveTextContent('Working');
    await expect(canvas.getByTitle('walker-2: Waiting')).toHaveTextContent('Waiting');
  },
};
