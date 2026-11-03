import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { carried, labelContext, PROJECT } from '../../../../lib/fixtures/labels.fixtures';
import { DEFAULT_FLEET_VIEW, type FleetView } from '../../services/fleet-filter';
import { FleetBar } from './fleet-bar';

/** The mockup's fleet: 19 ships, as Harbour counts them. */
const COUNTS = { ships: 19, alert: 1, awaitingCrew: 2, blocked: 1, working: 8, idle: 7 };
const TYPES = [
  { type: 'builder', ships: 1 },
  { type: 'designer', ships: 1 },
  { type: 'host', ships: 2 },
  { type: 'infra', ships: 3 },
  { type: 'orchestrator', ships: 1 },
  { type: 'person', ships: 2 },
  { type: 'researcher', ships: 1 },
];
const LABELS = labelContext([]);
const FILTERED: FleetView = { ...DEFAULT_FLEET_VIEW, query: 'er', filters: { state: ['alert', 'blocked'], type: [], labelValueIds: [] } };

/** Keeps the view the way the overview keeps it in the address. */
function StatefulFleetBar({ view: initial, shown, isUpdating = false }: { view: FleetView; shown: number | undefined; isUpdating?: boolean }) {
  const [view, setView] = useState(initial);
  return <FleetBar view={view} onViewChange={setView} counts={COUNTS} types={TYPES} labels={LABELS} shown={shown} isUpdating={isUpdating} />;
}

const meta = {
  title: 'Organisms/FleetBar',
  component: StatefulFleetBar,
  args: { view: DEFAULT_FLEET_VIEW, shown: 19 },
} satisfies Meta<typeof StatefulFleetBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing narrows the view: the count says the whole fleet, no Clear filters, Cards picked. */
export const Rest: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('fleet-count')).toHaveTextContent('19 ships');
    await expect(canvas.queryByTestId('fleet-filters-clear')).toBeNull();
    await expect(canvas.getByTestId('fleet-view-cards')).toHaveAttribute('aria-checked', 'true');
  },
};

export const RestDark: Story = { ...Rest, globals: { theme: 'dark' } };

/** A search and two states in force: "4 of 19 ships" and Clear filters. */
export const Filtered: Story = {
  args: { view: FILTERED, shown: 4 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('fleet-count')).toHaveTextContent('4 of 19 ships');
    await expect(canvas.getByTestId('fleet-filter-state')).toHaveTextContent('State2 picked');
    await userEvent.click(canvas.getByTestId('fleet-filters-clear'));
    await expect(canvas.getByTestId('fleet-count')).toHaveTextContent('19 ships');
    await expect(canvas.getByTestId('fleet-search')).toHaveValue('');
  },
};

/** A pick is in and its result has not come: the count says Updating. */
export const Updating: Story = {
  args: { view: FILTERED, shown: 4, isUpdating: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('fleet-count')).toHaveTextContent('Updating');
  },
};

/** The State menu open: each state with its icon, word and count. */
export const StateOpen: Story = {
  args: { view: FILTERED, shown: 4 },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('fleet-filter-state'));
    const menu = within(canvasElement.ownerDocument.body);
    await expect(await menu.findByRole('option', { name: /Blocked\s*1/ })).toHaveAttribute('aria-selected', 'true');
    await expect(menu.getByRole('option', { name: /Working\s*8/ })).toHaveAttribute('aria-selected', 'false');
  },
};

/** The Type menu open: Find a type narrows it, a type is picked and the trigger names it. */
export const TypeOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('fleet-filter-type'));
    const popover = within(await within(canvasElement.ownerDocument.body).findByTestId('fleet-filter-type-popover'));
    await userEvent.type(popover.getByRole('textbox', { name: 'Find a type' }), 'inf');
    await expect(popover.queryByRole('button', { name: /builder/ })).toBeNull();
    await userEvent.click(popover.getByRole('button', { name: /infra/ }));
    await expect(canvas.getByTestId('fleet-filter-type')).toHaveTextContent('Typeinfra');
  },
};

/**
 * The Labels menu open (docs/design/fleet-overview, "Labels open"): its
 * trigger reads like State and Type; Find a label narrows the values, each
 * under its key with how many ships carry it; a pick checks it and shows
 * under the bar as "Ships with".
 */
export const LabelsOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('fleet-filter-labels')).toHaveTextContent(/^Labels$/);
    await userEvent.click(canvas.getByTestId('fleet-filter-labels'));
    const popover = within(await within(canvasElement.ownerDocument.body).findByTestId('fleet-filter-labels-popover'));
    await userEvent.type(popover.getByRole('textbox', { name: 'Find a label' }), 'hem');
    await expect(popover.getByRole('group', { name: 'project' })).toBeVisible();
    await expect(popover.queryByRole('group', { name: 'area' })).toBeNull();
    await userEvent.click(popover.getByRole('button', { name: /^hemma\s*\d+$/ }));
    await expect(popover.getByRole('button', { name: /^hemma\s*\d+$/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.getByTestId('fleet-filter-labels')).toHaveTextContent('Labels1 picked');
    await expect(canvas.getByTestId('fleet-picked-labels')).toHaveTextContent('Ships with');
  },
};

export const LabelsOpenDark: Story = { ...LabelsOpen, globals: { theme: 'dark' } };

/** A label value picked: "Ships with project=hemma" under the bar. */
export const LabelPicked: Story = {
  args: { view: { ...DEFAULT_FLEET_VIEW, filters: { state: [], type: [], labelValueIds: [carried(PROJECT, 'hemma').valueId] } }, shown: 3 },
};

/** The list picked: the switch moves to List. */
export const SwitchesToList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('fleet-view-list'));
    await expect(canvas.getByTestId('fleet-view-list')).toHaveAttribute('aria-checked', 'true');
  },
};

/** On the phone: the search, a filter button counting what is in force, the icon switch, and a chip per filter. */
export const PhoneFiltered: Story = {
  args: { view: { ...DEFAULT_FLEET_VIEW, filters: { state: ['alert', 'blocked'], type: ['builder'], labelValueIds: [] } }, shown: 1 },
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('fleet-filters-open')).toHaveAccessibleName('Filter ships, 2 in force');
    await expect(canvas.getByTestId('fleet-filter-chips')).toHaveTextContent('State: Alert, Blocked');
    await userEvent.click(canvas.getByRole('button', { name: 'Clear type' }));
    await expect(canvas.getByTestId('fleet-filters-open')).toHaveAccessibleName('Filter ships, 1 in force');
  },
};

export const PhoneFilteredDark: Story = { ...PhoneFiltered, globals: { viewport: { value: 'mobile1' }, theme: 'dark' } };

/** The phone's filter Sheet open: State, Type and Label, Show N ships and Clear filters. */
export const PhoneSheet: Story = {
  args: PhoneFiltered.args,
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('fleet-filters-open'));
    const sheet = within(canvasElement.ownerDocument.body);
    await expect(await sheet.findByTestId('fleet-filters-apply')).toHaveTextContent('Show 1 ship');
  },
};
