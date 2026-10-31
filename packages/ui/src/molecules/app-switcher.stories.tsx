import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, within } from 'storybook/test';

import { accountIdSchema, createIdGenerator, type AppsList } from '@aeolus-fleet/common';
import { appSwitcherOf } from '@aeolus-fleet/common/rules';
import { AppSwitcher } from './app-switcher.js';

const newId = createIdGenerator();
const ACME = newId('fleet');
const LABS = newId('fleet');

/** Charlotte's list; the addresses are fragments, so a story that opens one stays on its page. */
const LIST: AppsList = {
  account: { id: accountIdSchema.parse('acc-charlotte'), email: 'charlotte@acme.example' },
  apps: [{ app: 'account', url: 'https://account.example/account#account' }],
  fleets: [
    { id: ACME, name: 'Acme', argo: true, apps: [{ app: 'console', url: 'https://fleet.example/#console' }, { app: 'gateway', url: 'https://gateway.example/#gateway' }] },
    { id: LABS, name: 'Labs', argo: false, apps: [{ app: 'console', url: 'https://fleet.example/#labs' }] },
  ],
};

const SWITCHER = appSwitcherOf({ list: LIST, fleet: { id: ACME, name: 'Acme' }, app: 'console' });

/** Opening a choice in a story would leave the page: the click is kept from going anywhere, and the choice still says it is on its way. */
function stayOnPage(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('a[href^="https://"]')) {
    event.preventDefault();
  }
}

const meta = {
  title: 'Header/AppSwitcher',
  component: AppSwitcher,
  args: { switcher: SWITCHER, layout: 'full' },
  decorators: [
    (Story) => (
      <div className="min-h-96 p-4" onClickCapture={(event) => { stayOnPage(event.nativeEvent); }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AppSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

/** "Acme / Console ▾": the fleet part and the app part, each a menu. */
export const Default: Story = {};

/** The fleet part lists the account's fleets, the one in view checked. */
export const Fleets: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('app-switcher-fleets'));
    const fleets = await screen.findAllByTestId('app-switcher-fleet');
    await expect(fleets.map((fleet) => fleet.textContent)).toEqual(['Acme', 'Labs']);
  },
};

/** The app part lists the apps of the fleet in view, then Account. */
export const Apps: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('app-switcher-apps'));
    const apps = await screen.findAllByTestId('app-switcher-app');
    await expect(apps.map((app) => app.textContent)).toEqual(['Console', 'Gateway', 'Account']);
  },
};

/** Choosing an app says it is opening at once, before the browser leaves. */
export const Opening: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('app-switcher-apps'));
    const gateway = (await screen.findAllByTestId('app-switcher-app')).find((app) => app.textContent === 'Gateway');
    if (gateway === undefined) {
      throw new Error('the switcher offers no Gateway');
    }
    await userEvent.click(gateway);
    await expect(gateway).toHaveTextContent('Opening Gateway');
  },
};

/** Without a list (argo's sign-in, the viewer, self-hosted): the fleet and the app, with no ▾ (H8). */
export const NothingToSwitch: Story = {
  args: { switcher: appSwitcherOf({ list: undefined, fleet: { id: ACME, name: 'Acme' }, app: 'console' }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('app-switcher')).toHaveTextContent('Acme/Console');
    await expect(within(canvasElement).queryByRole('button')).toBeNull();
  },
};

/** Phone: the app name with ▾ opens one bottom Sheet, the fleets then the apps (H6). */
export const Phone: Story = {
  args: { layout: 'compact' },
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('app-switcher'));
    const sheet = await screen.findByTestId('app-switcher-sheet');
    await expect(within(sheet).getAllByTestId('app-switcher-fleet')).toHaveLength(2);
    await expect(within(sheet).getAllByTestId('app-switcher-app')).toHaveLength(3);
  },
};

/** Phone, choosing a fleet: it says it is opening at once. */
export const PhoneOpening: Story = {
  args: { layout: 'compact' },
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('app-switcher'));
    const labs = within(await screen.findByTestId('app-switcher-sheet')).getAllByTestId('app-switcher-fleet')[1];
    if (labs === undefined) {
      throw new Error('the switcher offers no second fleet');
    }
    await userEvent.click(labs);
    await expect(labs).toHaveTextContent('Opening Labs');
  },
};
