import { idSchema, type ReachRefusal } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { AREA, BLUEPRINT, carried, labelContext, labelledFleet, OS, PROJECT } from './labels.fixtures';
import { ReachRefusalLog } from './reach-refusal-log';

const NOW = new Date('2026-10-10T12:00:00.000Z');

function aShip(name: string, ship: { suffix: string; labels?: ReachRefusal['sender']['labels'] }): ReachRefusal['sender'] {
  return { id: idSchema('ship').parse(`shp_01m4k0000000000000000000${ship.suffix}`), name, labels: ship.labels ?? [] };
}

const SCOUT = aShip('scout-1', { suffix: '01' });
const HEMMA_API = aShip('hemma-api', { suffix: '02', labels: [carried(PROJECT, 'hemma'), carried(AREA, 'backend'), carried(BLUEPRINT, 'hemma-feature')] });
const WEBSITE = aShip('website-editor', { suffix: '03', labels: [carried(PROJECT, 'website'), carried(OS, 'linux')] });
const REVIEWER_1 = aShip('reviewer-1', { suffix: '04', labels: [carried(AREA, 'review')] });
const REVIEWER_2 = aShip('reviewer-2', { suffix: '05', labels: [carried(AREA, 'review'), carried(PROJECT, 'aeolus')] });

function aRefusal(suffix: string, refusal: Partial<ReachRefusal> & { minutesAgo: number }): ReachRefusal {
  const { minutesAgo, ...rest } = refusal;
  return {
    id: idSchema('reachRefusal').parse(`rfs_01m4k000000000000000000${suffix.padStart(3, '0')}`),
    at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
    sender: WEBSITE,
    recipient: { kind: 'ship', ship: HEMMA_API },
    settingsVersion: 7,
    whilePluginUnavailable: null,
    ...rest,
  };
}

const TO_A_TYPE = aRefusal('02', { minutesAgo: 40, sender: SCOUT, recipient: { kind: 'type', type: 'reviewer', ships: [REVIEWER_1, REVIEWER_2] } });
const REFUSALS = [
  aRefusal('01', { minutesAgo: 4 }),
  TO_A_TYPE,
  aRefusal('03', { minutesAgo: 60 * 30, settingsVersion: 5, sender: SCOUT, whilePluginUnavailable: 'block-all' }),
];

const meta = {
  title: 'Organisms/ReachRefusalLog',
  component: ReachRefusalLog,
  args: { refusals: REFUSALS, context: labelContext(labelledFleet()), now: NOW, onRetry: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReachRefusalLog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Newest first: each says who tried to message whom, both ships' labels then, and the settings version that refused it. */
export const Refusals: Story = {
  play: async ({ canvasElement }) => {
    const refusals = within(canvasElement).getAllByTestId('network-refusal');
    await expect(refusals.map((refusal) => refusal.querySelector('p')?.textContent)).toEqual([
      'website-editor tried to message hemma-api.',
      'scout-1 tried to message the type reviewer: reviewer-1 and reviewer-2.',
      'scout-1 tried to message hemma-api.',
    ]);
  },
};
/** A send to a type: each ship of it the sender could not reach, with its labels. */
export const ToAType: Story = { args: { refusals: [TO_A_TYPE] } };
/** Refused while the networking plugin was not responding: what it declared for that is said. */
export const WhilePluginUnavailable: Story = {
  args: {
    refusals: [
      aRefusal('04', { minutesAgo: 2, whilePluginUnavailable: 'block-all' }),
      aRefusal('05', { minutesAgo: 9, whilePluginUnavailable: 'keep-latest', settingsVersion: 6 }),
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByTestId('network-refusal')[0]).toHaveTextContent(
      'Refused by network settings version 7 while the networking plugin was not responding: Block all.',
    );
  },
};
/** A label deleted since the refusal: its chip has no mark and says the label no longer exists. */
export const WithALabelDeletedSince: Story = {
  args: {
    refusals: [
      aRefusal('07', {
        minutesAgo: 3,
        sender: aShip('scout-2', {
          suffix: '07',
          labels: [{ labelId: idSchema('label').parse('lbl_01m4k0000000000000000000zz'), key: 'tier', valueId: idSchema('labelValue').parse('lbv_01m4k0000000000000000000zz'), value: 'gold' }],
        }),
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByTestId('network-refusal-label')[0]).toHaveAttribute('title', 'tier=gold, a label that no longer exists');
  },
};
/** Neither ship carried a label then. */
export const WithoutLabels: Story = { args: { refusals: [aRefusal('06', { minutesAgo: 1, sender: SCOUT, recipient: { kind: 'ship', ship: aShip('vault', { suffix: '06' }) } })] } };
/** No send refused yet: one quiet line. */
export const NoRefusals: Story = {
  args: { refusals: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('No send has been refused.')).toBeVisible();
  },
};
export const Loading: Story = { args: { refusals: undefined } };
/** The fleet could not list them: the error says so, with Try again. */
export const ReadFailed: Story = {
  args: { refusals: undefined, error: 'The fleet did not answer' },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /try again/i }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};
/** As many as argo reads at once, the latest 100. */
export const Many: Story = {
  args: { refusals: Array.from({ length: 100 }, (_, index) => aRefusal(String(index + 10), { minutesAgo: index * 7, sender: index % 2 === 0 ? SCOUT : WEBSITE })) },
};
/** On a phone the cards keep one column: the time and the labels wrap under the sentence. */
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
