import type { Meta, StoryObj } from '@storybook/react-vite';
import type { MouseEvent } from 'react';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';

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

/** Console in Aeolus, as the person's list gives it. */
const IN_AEOLUS = appSwitcherOf({ list: LIST, fleet: { id: AEOLUS, name: 'Aeolus' }, app: 'console' });

const meta = {
  title: 'Header/AppSwitcher',
  component: AppSwitcher,
  args: { switcher: IN_AEOLUS, layout: 'menu' },
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

/** The stories' links lead off the page: a press is kept from leaving, so the panel can be read after it. */
function stayOnPage(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('a[href^="https://"]')) {
    event.preventDefault();
  }
}

const staysOnPage: Story['decorators'] = [
  (Story) => (
    <div onClickCapture={stayOnPage}>
      <Story />
    </div>
  ),
];

function choiceIn(panel: HTMLElement, choice: { testId: 'app-switcher-app' | 'app-switcher-fleet'; name: string }): HTMLElement {
  const { testId, name } = choice;
  const found = within(panel).getAllByTestId(testId).find((item) => item.dataset.name === name);
  if (found === undefined) {
    throw new Error(`the panel offers no ${name}`);
  }
  return found;
}

async function reopen(canvasElement: HTMLElement): Promise<HTMLElement> {
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByTestId('app-switcher-panel')).toBeNull());
  await userEvent.click(within(canvasElement).getByTestId('app-switcher-launcher'));
  return screen.findByTestId('app-switcher-panel');
}

/** Ctrl or Cmd on an app opens it in a new tab and this page stays: no tile says Opening, nothing waits. */
export const ModifierOpensAppElsewhere: Story = {
  decorators: staysOnPage,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('app-switcher-launcher'));
    const panel = await screen.findByTestId('app-switcher-panel');
    await userEvent.keyboard('{Control>}');
    await userEvent.click(choiceIn(panel, { testId: 'app-switcher-app', name: 'Gateway' }));
    await userEvent.keyboard('{/Control}');
    await expect(choiceIn(panel, { testId: 'app-switcher-app', name: 'Gateway' })).toHaveAccessibleName('Gateway');
    await expect(choiceIn(panel, { testId: 'app-switcher-app', name: 'Account' })).not.toHaveAttribute('aria-disabled');
    await expect(choiceIn(panel, { testId: 'app-switcher-fleet', name: 'Harbour' })).not.toHaveAttribute('aria-disabled');
    await expect(within(panel).queryByTestId('app-switcher-busy')).toBeNull();
  },
};

/** An app that opened in this tab but whose page stayed: closing the panel ends Opening, so it reopens with every choice free. */
export const OpeningAppEndsWhenClosed: Story = {
  decorators: staysOnPage,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('app-switcher-launcher'));
    const panel = await screen.findByTestId('app-switcher-panel');
    await userEvent.click(choiceIn(panel, { testId: 'app-switcher-app', name: 'Gateway' }));
    await expect(choiceIn(panel, { testId: 'app-switcher-app', name: 'Gateway' })).toHaveAccessibleName('Opening Gateway');
    const reopened = await reopen(canvasElement);
    await expect(choiceIn(reopened, { testId: 'app-switcher-app', name: 'Gateway' })).toHaveAccessibleName('Gateway');
    await expect(choiceIn(reopened, { testId: 'app-switcher-app', name: 'Account' })).not.toHaveAttribute('aria-disabled');
    await expect(within(reopened).queryByText('Opening Gateway…')).toBeNull();
  },
};

/** Back to this page from the browser's history: Opening ends, every choice is free again. */
export const OpeningAppEndsOnReturn: Story = {
  decorators: staysOnPage,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('app-switcher-launcher'));
    const panel = await screen.findByTestId('app-switcher-panel');
    await userEvent.click(choiceIn(panel, { testId: 'app-switcher-app', name: 'Gateway' }));
    await expect(choiceIn(panel, { testId: 'app-switcher-app', name: 'Gateway' })).toHaveAccessibleName('Opening Gateway');
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    await waitFor(() => expect(choiceIn(panel, { testId: 'app-switcher-app', name: 'Gateway' })).toHaveAccessibleName('Gateway'));
    await expect(choiceIn(panel, { testId: 'app-switcher-fleet', name: 'Harbour' })).not.toHaveAttribute('aria-disabled');
  },
};

/** A fleet row the app does not handle is a plain link: Ctrl or Cmd opens it elsewhere, and nothing says Opening. */
export const ModifierOpensFleetElsewhere: Story = {
  decorators: staysOnPage,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('app-switcher-launcher'));
    const panel = await screen.findByTestId('app-switcher-panel');
    await userEvent.keyboard('{Control>}');
    await userEvent.click(choiceIn(panel, { testId: 'app-switcher-fleet', name: 'Harbour' }));
    await userEvent.keyboard('{/Control}');
    await expect(choiceIn(panel, { testId: 'app-switcher-fleet', name: 'Harbour' })).toHaveTextContent(/^Harbour$/);
    await expect(choiceIn(panel, { testId: 'app-switcher-app', name: 'Gateway' })).not.toHaveAttribute('aria-disabled');
    await expect(within(canvasElement).getByTestId('app-switcher-fleet-pill')).not.toHaveAttribute('aria-busy');
  },
};

/** A plain fleet link whose page stayed: closing the panel ends Opening. */
export const OpeningFleetEndsWhenClosed: Story = {
  decorators: staysOnPage,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('app-switcher-launcher'));
    const panel = await screen.findByTestId('app-switcher-panel');
    await userEvent.click(choiceIn(panel, { testId: 'app-switcher-fleet', name: 'Harbour' }));
    await expect(choiceIn(panel, { testId: 'app-switcher-fleet', name: 'Harbour' })).toHaveTextContent('Opening Harbour');
    const reopened = await reopen(canvasElement);
    await expect(choiceIn(reopened, { testId: 'app-switcher-fleet', name: 'Harbour' })).toHaveTextContent(/^Harbour$/);
    await expect(choiceIn(reopened, { testId: 'app-switcher-app', name: 'Gateway' })).not.toHaveAttribute('aria-disabled');
    await expect(within(canvasElement).getByTestId('app-switcher-fleet-pill')).not.toHaveAttribute('aria-busy');
  },
};

/** A failed fleet the app cannot open again from here: no Try again that does nothing. */
export const SwitchFailedWithoutOpen: Story = {
  args: { state: { fleetSwitch: { fleetId: HARBOUR, state: 'failed' } } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('app-switcher-launcher'));
    const panel = await screen.findByTestId('app-switcher-panel');
    await expect(within(panel).getByRole('alert')).toHaveTextContent('Couldn’t open Harbour');
    await expect(within(panel).queryByTestId('app-switcher-fleet-retry')).toBeNull();
  },
};

/** The fleet pill on the muted token, as the mockups draw it. */
export const FleetPillMuted: Story = {
  play: async ({ canvasElement }) => {
    const pill = within(canvasElement).getByTestId('app-switcher-fleet-pill');
    await expect(pill).toHaveClass('bg-muted');
    await expect(pill).not.toHaveClass('bg-secondary');
  },
};

/** An app open that the list does not hold: the tiles keep one tab stop, the first tile. */
export const CurrentAppNotListed: Story = {
  args: { switcher: { ...IN_AEOLUS, apps: IN_AEOLUS.apps.filter((app) => !app.isCurrent) } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('app-switcher-launcher'));
    const panel = await screen.findByTestId('app-switcher-panel');
    const stops = within(panel).getAllByTestId('app-switcher-app').filter((tile) => tile.tabIndex === 0);
    await expect(stops.map((tile) => tile.dataset.name)).toEqual(['Gateway']);
  },
};
