import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { HarbourGroup } from './harbour-group.js';

const NOW = new Date('2026-11-03T12:00:00.000Z');

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

const meta = {
  title: 'Harbour/HarbourGroup',
  component: HarbourGroup,
  args: {
    kind: 'people',
    tiles: [
      { id: 'shp_thomas', name: 'thomas', state: 'awaitingCrew', note: '4 wait on you', lastActivityAt: minutesAgo(12) },
      { id: 'shp_argo', name: 'argo', state: 'idle', note: 'Nothing open', lastActivityAt: minutesAgo(180) },
      { id: 'shp_th1989', name: 'thomas-hendrickx1989', state: 'idle', note: 'Signed in, nothing open', lastActivityAt: minutesAgo(24 * 60 + 30) },
    ],
    hrefOf: (shipId) => `#${shipId}`,
    now: NOW,
  },
  // Harbour is the container the tiles' columns read.
  decorators: [
    (Story) => (
      <div className="@container w-284">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HarbourGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Its icon, word and how many ships, then the tiles in the order given. */
export const People: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('heading', { name: 'People 3' })).toBeInTheDocument();
    await expect(
      within(canvasElement)
        .getAllByTestId('harbour-tile')
        .map((tile) => tile.title),
    ).toEqual(['thomas: 4 wait on you', 'argo: Nothing open', 'thomas-hendrickx1989: Signed in, nothing open']);
  },
};

/** Through the gateway: the proxy ships the gateway crews. */
export const ThroughTheGateway: Story = {
  args: {
    kind: 'gateway',
    tiles: [
      { id: 'shp_memory', name: 'company-memory', state: 'idle', note: 'Last call: search', lastActivityAt: minutesAgo(40) },
      { id: 'shp_attio', name: 'attio', state: 'idle', note: 'Last call: list contacts', lastActivityAt: minutesAgo(180) },
    ],
  },
};
