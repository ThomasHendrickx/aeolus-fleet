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

const MANY_TILES = Array.from({ length: 14 }, (_, index) => ({
  id: `shp_agent${index}`,
  name: `agent-${index}`,
  state: 'idle' as const,
  note: 'Nothing open',
  lastActivityAt: minutesAgo(index * 10),
}));

const REM = 16;

/** How many tiles the first row holds, and every tile's width in rem. */
function rowOf(canvasElement: HTMLElement): { perRow: number; widths: number[] } {
  const tiles = within(canvasElement).getAllByTestId('harbour-tile');
  const firstTop = tiles[0]?.getBoundingClientRect().top;
  return {
    perRow: tiles.filter((tile) => tile.getBoundingClientRect().top === firstTop).length,
    widths: tiles.map((tile) => tile.getBoundingClientRect().width / REM),
  };
}

function inHarbourOf(widthRem: number): Story['decorators'] {
  return [
    (Story) => (
      <div className="@container" style={{ width: `${widthRem}rem` }}>
        <Story />
      </div>
    ),
  ];
}

/** As many tiles as fit, each between 12rem and 18rem (#1672): five in the console's Harbour at 1440. */
export const AsManyAsFit: Story = {
  args: { kind: 'agents', tiles: MANY_TILES },
  play: async ({ canvasElement }) => {
    const { perRow, widths } = rowOf(canvasElement);
    await expect(perRow).toBe(5);
    await expect(widths.every((width) => width >= 12 && width <= 18)).toBe(true);
  },
};

/** An ultra-wide window holds more a row. */
export const UltraWide: Story = {
  args: { kind: 'agents', tiles: MANY_TILES },
  decorators: inHarbourOf(150),
  play: async ({ canvasElement }) => {
    const { perRow, widths } = rowOf(canvasElement);
    await expect(perRow).toBe(12);
    await expect(widths.every((width) => width >= 12 && width <= 18)).toBe(true);
  },
};

/** Where two fit but a third does not, the tiles stop at 18rem and leave the space. */
export const NoWiderThanTheRange: Story = {
  args: { kind: 'agents', tiles: MANY_TILES },
  decorators: inHarbourOf(36.9),
  play: async ({ canvasElement }) => {
    const { perRow, widths } = rowOf(canvasElement);
    await expect(perRow).toBe(2);
    await expect(widths.every((width) => width >= 12 && width <= 18)).toBe(true);
  },
};

/** On a phone, under two tiles' width, two a row. */
export const OnAPhone: Story = {
  args: { kind: 'agents', tiles: MANY_TILES },
  decorators: inHarbourOf(21.4),
  play: async ({ canvasElement }) => {
    await expect(rowOf(canvasElement).perRow).toBe(2);
  },
};
