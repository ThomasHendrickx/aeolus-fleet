import { idSchema, type ShipId } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import type { GraphShip } from '../../lib/reach-graph';
import { FleetReachGraph } from './fleet-reach-graph';

function aShip(name: string, suffix: string): GraphShip {
  return { id: idSchema('ship').parse(`shp_01m4k0000000000000000000${suffix}`), name, isOperator: name === 'argo' };
}

const ARGO = aShip('argo', '01');
const PLANNER = aShip('planner', '02');
const SCOUT = aShip('scout', '03');
const VAULT = aShip('vault', '04');
const NETWORKING = aShip('networking-plugin', '05');
const SHIPS = [ARGO, NETWORKING, PLANNER, SCOUT, VAULT];

function idsOf(...ships: GraphShip[]): ShipId[] {
  return ships.map((ship) => ship.id);
}

const meta = {
  title: 'Organisms/FleetReachGraph',
  component: FleetReachGraph,
  args: { ships: SHIPS, pickedShipId: undefined, reachableShipIds: undefined, onPick: fn(), onRetry: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FleetReachGraph>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No ship picked: the fleet, waiting for argo to pick one. */
export const NothingPicked: Story = {};
/** A ship picked, its reach not known yet. */
export const Finding: Story = { args: { pickedShipId: SCOUT.id } };
/** The rules let scout reach planner and argo: those stand out, the others dim. */
export const Reaching: Story = {
  args: { pickedShipId: SCOUT.id, reachableShipIds: idsOf(ARGO, PLANNER) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'vault, out of reach' })).toBeVisible();
    await expect(canvas.getByTestId('network-reach-summary')).toHaveTextContent('scout may message 2 of 4 ships: argo, planner.');
  },
};
/** No rules, or argo picked: every other ship is reached. */
export const ReachesEveryShip: Story = { args: { pickedShipId: ARGO.id, reachableShipIds: idsOf(NETWORKING, PLANNER, SCOUT, VAULT) } };
/** Under block-all, or an empty list, a ship reaches only argo. */
export const ReachesOnlyArgo: Story = { args: { pickedShipId: VAULT.id, reachableShipIds: idsOf(ARGO) } };
/** The fleet could not explain: the graph stays, the error says so with Try again. */
export const ExplainFailed: Story = { args: { pickedShipId: SCOUT.id, reachableShipIds: undefined, reachError: 'The fleet did not answer' } };
/** argo alone in the fleet. */
export const OnlyArgo: Story = { args: { ships: [ARGO], pickedShipId: ARGO.id, reachableShipIds: [] } };
/** A larger fleet stays legible on the circle. */
export const ManyShips: Story = {
  args: {
    ships: [ARGO, ...Array.from({ length: 15 }, (_, index) => aShip(`reviewer-${String(index + 1)}`, String(index + 10)))],
  },
};
/** Picking a ship asks for its reach; picking it again lets go. */
export const Picking: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'scout' }));
    await expect(args.onPick).toHaveBeenCalledWith(SCOUT.id);
  },
};
export const LettingGo: Story = {
  args: { pickedShipId: SCOUT.id, reachableShipIds: idsOf(ARGO, PLANNER) },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'scout, picked' }));
    await expect(args.onPick).toHaveBeenCalledWith(undefined);
  },
};
/** On a phone the ships wrap as a list, without lines. */
export const Phone: Story = { args: { pickedShipId: SCOUT.id, reachableShipIds: idsOf(ARGO, PLANNER) }, globals: { viewport: { value: 'mobile1' } } };
