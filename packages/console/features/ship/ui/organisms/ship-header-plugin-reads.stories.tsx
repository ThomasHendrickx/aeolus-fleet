import type { ShipDetail } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { CREWED_SHIP } from '../../../../lib/fixtures/ship-page.fixtures';
import { ShipHeader } from './ship-header';

const plugin: ShipDetail = {
  ...CREWED_SHIP,
  name: 'trierarch-plugin',
  type: 'trierarch-plugin',
  kind: 'plugin',
  harness: null,
  location: { kind: 'SERVER', description: null },
  scopes: ['fleet:read'],
  lastSeenAt: null,
  commissionedAt: '2026-11-25T09:12:00Z',
  crewedSince: '2026-11-25T09:12:00Z',
};
const firstFailure = { at: '2026-11-25T14:02:00Z', read: 'guard.get', reason: 'no-answer' } as const;
const lastFailure = { at: '2026-11-25T14:06:00Z', read: 'guard.get', reason: 'unusable-answer' } as const;
const lastGood = { at: '2026-11-25T13:56:00Z', read: 'guard.get' };

const meta = {
  title: 'Scenarios/Ship/Plugin reads',
  component: ShipHeader,
  args: {
    ship: plugin,
    state: 'ready',
    now: new Date('2026-11-25T14:07:00Z'),
    viewerFleetId: undefined,
    isPluginShip: true,
    owner: 'argo',
  },
} satisfies Meta<typeof ShipHeader>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Failing: Story = {
  args: { ship: { ...plugin, pluginReads: { failingSince: firstFailure, lastFailed: lastFailure, lastGood } } },
  play: async ({ canvasElement }) => {
    // Given a plugin ship with a recorded failure run and an earlier good read.
    // When its ship page shows the recorded read fact.
    const canvas = within(canvasElement);
    const reads = canvas.getByTestId('ship-plugin-reads');
    // Then the attention heading and three facts appear between details and Permissions.
    await expect(within(reads).getByRole('heading', { name: 'Plugin read failed' })).toBeVisible();
    const terms = within(reads).getAllByRole('term');
    await expect(terms.map((term) => term.textContent))
      .toEqual(['Failing since', 'Last failed read', 'Last good read']);
    await expect([...reads.querySelectorAll('time')].map((time) => time.dateTime))
      .toEqual(['2026-11-25T14:02:00Z', '2026-11-25T14:06:00Z', '2026-11-25T13:56:00Z']);
    const values = within(reads).getAllByText('guard.get');
    await expect(values).toHaveLength(3);
    const valueOffsets = values.map((value, index) =>
      value.getBoundingClientRect().top - (terms[index]?.getBoundingClientRect().top ?? NaN));
    await expect(new Set(valueOffsets).size).toBe(1);
    await expect(within(reads).getByText('An answer the console cannot use')).toBeVisible();
    await expect(canvas.getByText('Commissioned').compareDocumentPosition(reads)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await expect(reads.compareDocumentPosition(canvas.getByRole('heading', { name: 'Permissions' }))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  },
};

export const Recovered: Story = {
  args: { ship: { ...plugin, pluginReads: { failingSince: null, lastFailed: firstFailure, lastGood: { ...lastGood, at: '2026-11-25T14:04:00Z' } } } },
  play: async ({ canvasElement }) => {
    const reads = within(within(canvasElement).getByTestId('ship-plugin-reads'));
    await expect(reads.queryByRole('heading', { name: 'Plugin read failed' })).toBeNull();
    await expect(reads.getAllByRole('term').map((term) => term.textContent)).toEqual(['Last failed read', 'Last good read']);
    await expect(reads.getByText('No answer')).toBeVisible();
  },
};

export const FirstReadFailed: Story = {
  args: { ship: { ...plugin, pluginReads: { failingSince: firstFailure, lastFailed: { ...lastFailure, reason: 'timeout' }, lastGood: null } } },
  play: async ({ canvasElement }) => {
    // Given the plugin's first recorded read failed.
    // When its ship page shows the recorded read fact.
    const reads = within(within(canvasElement).getByTestId('ship-plugin-reads'));
    // Then the failure is shown without a Last good read row.
    await expect(reads.getByText('Timeout')).toBeVisible();
    await expect(reads.getAllByRole('term').map((term) => term.textContent)).toEqual(['Failing since', 'Last failed read']);
  },
};

export const GoodOnly: Story = {
  args: { ship: { ...plugin, pluginReads: { failingSince: null, lastFailed: null, lastGood } } },
  play: async ({ canvasElement }) => {
    const reads = within(within(canvasElement).getByTestId('ship-plugin-reads'));
    await expect(reads.getAllByRole('term').map((term) => term.textContent)).toEqual(['Last good read']);
    await expect(reads.getByText('guard.get')).toBeVisible();
  },
};

export const NoReads: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId('ship-plugin-reads')).toBeNull();
  },
};
