import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, within } from 'storybook/test';

import { accountIdSchema, createIdGenerator, type AppsList } from '@aeolus-fleet/common';
import { appSwitcherOf } from '@aeolus-fleet/common/rules';
import { AppSwitcher } from './app-switcher.js';

const newId = createIdGenerator();
const AEOLUS = newId('fleet');
const HARBOUR = newId('fleet');

/** The addresses are fragments, so a story that opens one stays on its page. */
const LIST: AppsList = {
  account: { id: accountIdSchema.parse('acc-charlotte'), email: 'charlotte@acme.example' },
  apps: [{ app: 'account', url: 'https://account.example/#account' }],
  fleets: [
    { id: AEOLUS, name: 'Aeolus', argo: true, apps: [{ app: 'console', url: 'https://fleet.example/#console' }, { app: 'gateway', url: 'https://gateway.example/#gateway' }] },
    { id: HARBOUR, name: 'Harbour', argo: false, apps: [{ app: 'console', url: 'https://fleet.example/#harbour' }] },
  ],
};

const meta = {
  title: 'Header/AppSwitcher',
  component: AppSwitcher,
  args: { switcher: appSwitcherOf({ list: LIST, fleet: { id: AEOLUS, name: 'Aeolus' }, app: 'console' }), layout: 'menu' },
  decorators: [
    (Story) => (
      <div className="min-h-120 p-2">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AppSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The start of the bar: the launcher, the app open and the fleet in view, read as "Fleet: Aeolus". */
export const WhereYouAre: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Apps and fleets' })).toBeInTheDocument();
    await expect(canvas.getByTestId('app-switcher-app-name')).toHaveTextContent('Console');
    await expect(canvas.getByTestId('app-switcher-fleet-pill')).toHaveTextContent('Fleet: Aeolus');
  },
};

/** Desktop: the launcher opens one menu panel, the apps as tiles and the fleets as rows. */
export const Menu: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('app-switcher-launcher'));
    const panel = await screen.findByTestId('app-switcher-panel');
    await expect(within(panel).getAllByTestId('app-switcher-app').map((tile) => tile.dataset.name)).toEqual(['Console', 'Gateway', 'Account']);
    await expect(within(panel).getAllByTestId('app-switcher-fleet').map((row) => row.dataset.name)).toEqual(['Aeolus', 'Harbour']);
  },
};

/** Phone: the same panel as a bottom sheet, titled, with Cancel last. */
export const Sheet: Story = {
  args: { layout: 'sheet' },
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('app-switcher-launcher'));
    const panel = await screen.findByTestId('app-switcher-panel');
    await expect(within(panel).getByRole('heading', { name: 'Apps and fleets' })).toBeInTheDocument();
    const buttons = within(panel).getAllByRole('button');
    await expect(buttons.at(-1)).toHaveTextContent('Cancel');
  },
};
