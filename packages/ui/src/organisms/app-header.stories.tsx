import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';

import { accountIdSchema, createIdGenerator, type AppsList, type FleetId, type HeaderApp } from '@aeolus-fleet/common';
import { appSwitcherOf } from '@aeolus-fleet/common/rules';
import type { AppAccess, AppsAndFleetsLimit, AppsAndFleetsRead, FleetSwitch } from '../molecules/app-switcher.js';
import { ArrivalLine } from '../molecules/arrival-line.js';
import type { SignedInAs } from '../molecules/signed-in-as.js';
import { AppHeader } from './app-header.js';

/*
 * The bar as the approved mockups draw it (docs/design/app-navigation,
 * section 4 and its states): every state on desktop and phone, light and
 * dark. The story stands in for the app: it holds the fleet in view and the
 * state of each choice, and answers after a short wait, so a press shows its
 * pending state before the answer arrives.
 */

const newId = createIdGenerator();

/** How long the story's app takes to answer a choice. */
const ANSWER_MS = 700;

type Fleets = 'two' | 'one' | 'long';

const FLEET_NAMES: Record<Fleets, readonly string[]> = {
  two: ['Aeolus', 'Harbour'],
  one: ['Aeolus'],
  long: ['Aeolus research and development', 'Harbour operations and logistics, northern region'],
};

const FLEET_IDS: Record<string, FleetId> = Object.fromEntries([...FLEET_NAMES.two, ...FLEET_NAMES.long].map((name) => [name, newId('fleet')]));

function fleetIdOf(name: string): FleetId {
  const id = FLEET_IDS[name];
  if (id === undefined) {
    throw new Error(`the story has no fleet ${name}`);
  }
  return id;
}

/** The person's list; the addresses are fragments, so a story that opens one stays on its page. */
function listOf(fleets: Fleets): AppsList {
  return {
    account: { id: accountIdSchema.parse('acc-charlotte'), email: 'charlotte@acme.example' },
    apps: [
      { app: 'account', url: 'https://account.example/#account' },
      { app: 'admin', url: 'https://admin.example/#admin' },
    ],
    fleets: FLEET_NAMES[fleets].map((name) => ({
      id: fleetIdOf(name),
      name,
      argo: false,
      apps: [
        { app: 'console', url: 'https://fleet.example/#console' },
        { app: 'gateway', url: 'https://gateway.example/#gateway' },
      ],
    })),
  };
}

/** Opening a link in a story would leave the page: the press is kept from going anywhere, and the choice still shows it is on its way. */
function stayOnPage(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('a[href^="https://"]')) {
    event.preventDefault();
  }
}

interface BarProps {
  layout: 'desktop' | 'phone';
  /** Console with "/ Fleet" after the fleet, or Gateway with Bridge's tabs. */
  surface: 'console' | 'bridge';
  fleets: Fleets;
  /** Argo's sign-in, the viewer and a single-app installation reach the app open alone. */
  limit?: AppsAndFleetsLimit;
  read?: AppsAndFleetsRead;
  appAccess?: Partial<Record<HeaderApp, AppAccess>>;
  /** The fleet being opened, by name, and how far it got. */
  switching?: { fleet: string; state: FleetSwitch['state'] };
  /** The first fleet chosen fails to open. */
  shouldFailFirstSwitch?: boolean;
  /** The fleet in view, when not the first. */
  fleet?: string;
  hasArrived?: boolean;
  isSigningIn?: boolean;
  isSigningOut?: boolean;
  isDetail?: boolean;
}

const SIGNED_IN_AS: Record<AppsAndFleetsLimit, SignedInAs> = { argo: 'argo', viewer: 'viewer', 'single-app': 'argo' };

/** The story's app: the bar, then the top of the page under it. */
function Bar(props: BarProps) {
  const { layout, surface, fleets, limit, appAccess, shouldFailFirstSwitch = false, isDetail = false } = props;
  const app: HeaderApp = surface === 'bridge' ? 'gateway' : 'console';
  const [fleet, setFleet] = useState(props.fleet ?? FLEET_NAMES[fleets][0] ?? 'Aeolus');
  const [switching, setSwitching] = useState(props.switching);
  const [hasFailed, setHasFailed] = useState(false);
  const [hasArrived, setHasArrived] = useState(props.hasArrived ?? false);
  const [read, setRead] = useState<AppsAndFleetsRead>(props.read ?? 'loaded');
  const [access, setAccess] = useState(appAccess);
  const [isSigningIn, setIsSigningIn] = useState(props.isSigningIn ?? false);
  const [isSigningOut, setIsSigningOut] = useState(props.isSigningOut ?? false);
  const switcher = appSwitcherOf({ list: limit === undefined ? listOf(fleets) : undefined, fleet: { id: fleetIdOf(fleet), name: fleet }, app });
  const signedInAs = limit === undefined ? 'account' : SIGNED_IN_AS[limit];
  const isExpired = access !== undefined && Object.values(access).includes('sign-in-required');
  return (
    <div
      className={layout === 'phone' ? 'w-93.75' : 'w-full'}
      onClickCapture={(event) => {
        stayOnPage(event.nativeEvent);
      }}
    >
      <AppHeader
        layout={layout}
        switcher={switcher}
        switcherState={{
          read,
          ...(limit === undefined ? {} : { limit }),
          ...(access === undefined ? {} : { appAccess: access }),
          ...(switching === undefined ? {} : { fleetSwitch: { fleetId: fleetIdOf(switching.fleet), state: switching.state } }),
          onOpenFleet: (chosen) => {
            setSwitching({ fleet: chosen.name, state: switching?.state === 'failed' ? 'retrying' : 'opening' });
            setTimeout(() => {
              if (shouldFailFirstSwitch && !hasFailed) {
                setHasFailed(true);
                setSwitching({ fleet: chosen.name, state: 'failed' });
                return;
              }
              setSwitching(undefined);
              setFleet(chosen.name);
              setHasArrived(true);
            }, ANSWER_MS);
          },
          onRetry: () => {
            setRead('retrying');
            setTimeout(() => {
              setAccess(undefined);
              setRead('refreshed');
            }, ANSWER_MS);
          },
          onSignIn: () => {
            setIsSigningIn(true);
          },
          isSigningIn,
        }}
        account={{
          name: limit === undefined ? 'Charlotte Ames' : undefined,
          signedInAs,
          ...(limit === undefined ? {} : { signedInFor: `${switcher.appLabel} in ${fleet}` }),
          isSignInExpired: isExpired,
          onSignOut: () => {
            setIsSigningOut(true);
          },
          isSigningOut,
        }}
      >
        {surface === 'bridge' ? (
          <span className="flex items-center gap-4 text-body text-muted-foreground max-sm:hidden">
            <span className="font-medium text-foreground">Bridge</span>
            <span>Outside parties</span>
          </span>
        ) : layout === 'desktop' ? (
          <span className="text-body text-muted-foreground">{isDetail ? '/ Fleet / builder-console' : '/ Fleet'}</span>
        ) : null}
      </AppHeader>
      <main className="flex flex-col gap-3 p-4">
        {hasArrived ? <ArrivalLine appLabel={switcher.appLabel} fleetName={fleet} /> : null}
        <h1 className="text-title font-semibold text-foreground">{isDetail ? 'builder-console' : surface === 'bridge' ? 'Waiting on you' : 'Fleet'}</h1>
      </main>
    </div>
  );
}

const meta = {
  title: 'Header/AppHeader',
  component: Bar,
  parameters: { layout: 'fullscreen' },
  args: { layout: 'desktop', surface: 'console', fleets: 'two' },
  decorators: [
    (Story) => (
      <div className="-m-6 min-h-200">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Bar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The same story on phone: the bar at 375 px, its panels as bottom Sheets. */
function onPhone(story: Story): Story {
  return { ...story, args: { ...story.args, layout: 'phone' }, globals: { ...story.globals, viewport: { value: 'mobile1' } } };
}

/** The same story in the dark theme. */
function inDark(story: Story): Story {
  return { ...story, globals: { ...story.globals, theme: 'dark' } };
}

async function openPanel(canvasElement: HTMLElement): Promise<HTMLElement> {
  await userEvent.click(within(canvasElement).getByTestId('app-switcher-launcher'));
  return screen.findByTestId('app-switcher-panel');
}

function fleetRow(panel: HTMLElement, name: string): HTMLElement {
  const row = within(panel).getAllByTestId('app-switcher-fleet').find((choice) => choice.dataset.name === name);
  if (row === undefined) {
    throw new Error(`the panel offers no fleet ${name}`);
  }
  return row;
}

function appTile(panel: HTMLElement, name: string): HTMLElement {
  const tile = within(panel).getAllByTestId('app-switcher-app').find((choice) => choice.dataset.name === name);
  if (tile === undefined) {
    throw new Error(`the panel offers no app ${name}`);
  }
  return tile;
}

/** Bar closed: the launcher, then the app and the fleet next to it; the account button at the end. */
export const Closed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Apps and fleets' })).toBeInTheDocument();
    await expect(canvas.getByTestId('app-switcher-app-name')).toHaveTextContent('Console');
    await expect(canvas.getByTestId('app-switcher-fleet-pill')).toHaveTextContent('Fleet: Aeolus');
    await expect(canvas.getByTestId('avatar-menu')).toHaveAccessibleName('Account: Your account');
  },
};
export const ClosedDark = inDark(Closed);
export const ClosedPhone = onPhone(Closed);
export const ClosedPhoneDark = inDark(onPhone(Closed));

/** Bridge's bar: Gateway, the fleet, then Bridge's own tabs. */
export const BridgeClosed: Story = {
  args: { surface: 'bridge' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('app-switcher-app-name')).toHaveTextContent('Gateway');
  },
};
export const BridgeClosedDark = inDark(BridgeClosed);
export const BridgeClosedPhone = onPhone(BridgeClosed);
export const BridgeClosedPhoneDark = inDark(onPhone(BridgeClosed));

/** Keyboard focus on the launcher: the bar's first stop. */
export const LauncherFocus: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await expect(within(canvasElement).getByTestId('app-switcher-launcher')).toHaveFocus();
  },
};
export const LauncherFocusDark = inDark(LauncherFocus);
export const LauncherFocusPhone = onPhone(LauncherFocus);
export const LauncherFocusPhoneDark = inDark(onPhone(LauncherFocus));

/** The panel open: the apps as tiles, the current one marked; the fleets as rows, the current one checked. */
export const Several: Story = {
  play: async ({ canvasElement }) => {
    const panel = await openPanel(canvasElement);
    await expect(within(panel).getByText('Apps and fleets')).toBeInTheDocument();
    await expect(within(panel).getAllByTestId('app-switcher-app').map((tile) => tile.dataset.name)).toEqual(['Console', 'Gateway', 'Account', 'Admin']);
    await expect(appTile(panel, 'Console')).toHaveAccessibleName('Console, current app');
    await expect(within(panel).getByText('Apps you can open in Aeolus')).toBeInTheDocument();
    await expect(within(panel).getByText('Choose a fleet. You stay in Console where that fleet has it.')).toBeInTheDocument();
    await expect(fleetRow(panel, 'Aeolus')).toHaveAttribute('aria-current', 'page');
    await expect(fleetRow(panel, 'Aeolus')).toHaveTextContent('Current fleet');
    await expect(fleetRow(panel, 'Harbour')).not.toHaveAttribute('aria-current');
  },
};
export const SeveralDark = inDark(Several);
export const SeveralPhone = onPhone(Several);
export const SeveralPhoneDark = inDark(onPhone(Several));
export const BridgeSeveral: Story = { ...Several, args: { surface: 'bridge' }, play: async ({ canvasElement }) => {
  const panel = await openPanel(canvasElement);
  await expect(appTile(panel, 'Gateway')).toHaveAccessibleName('Gateway, current app');
} };
export const BridgeSeveralDark = inDark(BridgeSeveral);
export const BridgeSeveralPhone = onPhone(BridgeSeveral);
export const BridgeSeveralPhoneDark = inDark(onPhone(BridgeSeveral));

/** By keyboard: Enter opens the panel on the current app's tile; the arrow keys move between tiles. */
export const Keyboard: Story = {
  play: async ({ canvasElement }) => {
    within(canvasElement).getByTestId('app-switcher-launcher').focus();
    await userEvent.keyboard('{Enter}');
    const panel = await screen.findByTestId('app-switcher-panel');
    await waitFor(() => expect(appTile(panel, 'Console')).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    await expect(appTile(panel, 'Admin')).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{ArrowRight}');
    await expect(appTile(panel, 'Gateway')).toHaveFocus();
  },
};
export const KeyboardDark = inDark(Keyboard);
export const KeyboardPhone = onPhone(Keyboard);
export const KeyboardPhoneDark = inDark(onPhone(Keyboard));

/** By keyboard: Tab moves from the tiles to the current fleet; Up, Down, Home and End move between fleets. */
export const FleetsKeyboard: Story = {
  play: async ({ canvasElement }) => {
    within(canvasElement).getByTestId('app-switcher-launcher').focus();
    await userEvent.keyboard('{Enter}');
    const panel = await screen.findByTestId('app-switcher-panel');
    await waitFor(() => expect(appTile(panel, 'Console')).toHaveFocus());
    await userEvent.tab();
    await expect(fleetRow(panel, 'Aeolus')).toHaveFocus();
    await userEvent.keyboard('{End}');
    await expect(fleetRow(panel, 'Harbour')).toHaveFocus();
    await userEvent.keyboard('{Home}');
    await expect(fleetRow(panel, 'Aeolus')).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(fleetRow(panel, 'Harbour')).toHaveFocus();
  },
};
export const FleetsKeyboardDark = inDark(FleetsKeyboard);
export const FleetsKeyboardPhone = onPhone(FleetsKeyboard);
export const FleetsKeyboardPhoneDark = inDark(onPhone(FleetsKeyboard));

/** Escape closes the panel and returns focus to the launcher; Shift+Tab from the account button reaches it too. */
export const EscapeReturnsFocus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    canvas.getByTestId('avatar-menu').focus();
    await userEvent.tab({ shift: true });
    await expect(canvas.getByTestId('app-switcher-launcher')).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await screen.findByTestId('app-switcher-panel');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('app-switcher-panel')).toBeNull());
    await expect(canvas.getByTestId('app-switcher-launcher')).toHaveFocus();
  },
};
export const EscapeReturnsFocusPhone = onPhone(EscapeReturnsFocus);

/** Choosing the fleet in view closes the panel and says it is already open; the bar stays as it was. */
export const ChooseCurrentFleet: Story = {
  play: async ({ canvasElement }) => {
    const panel = await openPanel(canvasElement);
    await userEvent.click(fleetRow(panel, 'Aeolus'));
    await waitFor(() => expect(screen.queryByTestId('app-switcher-panel')).toBeNull());
    await expect(within(canvasElement).getByText('Aeolus is already open')).toBeInTheDocument();
    await expect(within(canvasElement).getByTestId('app-switcher-fleet-pill')).toHaveTextContent('Aeolus');
  },
};

/** Switching fleet, loading: the row and the fleet pill are busy, the rest waits, "Opening Harbour…" under the list. */
export const Switching: Story = {
  args: { switching: { fleet: 'Harbour', state: 'opening' } },
  play: async ({ canvasElement }) => {
    const panel = await openPanel(canvasElement);
    await expect(fleetRow(panel, 'Harbour')).toHaveTextContent('Opening Harbour');
    await expect(fleetRow(panel, 'Harbour')).toHaveAttribute('aria-busy', 'true');
    await expect(fleetRow(panel, 'Aeolus')).toHaveAttribute('aria-disabled', 'true');
    await expect(appTile(panel, 'Gateway')).toHaveAttribute('aria-disabled', 'true');
    await expect(within(panel).getByText('Opening Harbour…')).toBeInTheDocument();
    await expect(within(canvasElement).getByTestId('app-switcher-fleet-pill')).toHaveAttribute('aria-busy', 'true');
  },
};
export const SwitchingDark = inDark(Switching);
export const SwitchingPhone = onPhone(Switching);
export const SwitchingPhoneDark = inDark(onPhone(Switching));

/** Switching fleet failed: where you still are, and Try again. */
export const SwitchFailed: Story = {
  args: { switching: { fleet: 'Harbour', state: 'failed' } },
  play: async ({ canvasElement }) => {
    const panel = await openPanel(canvasElement);
    await expect(within(panel).getByRole('alert')).toHaveTextContent('Couldn’t open Harbour');
    await expect(within(panel).getByText('You are still in Aeolus. Try again to open Harbour.')).toBeInTheDocument();
    await expect(fleetRow(panel, 'Harbour')).toHaveTextContent(/^Harbour$/);
    await expect(within(canvasElement).getByTestId('app-switcher-fleet-pill')).not.toHaveAttribute('aria-busy');
  },
};
export const SwitchFailedDark = inDark(SwitchFailed);
export const SwitchFailedPhone = onPhone(SwitchFailed);
export const SwitchFailedPhoneDark = inDark(onPhone(SwitchFailed));

/** Try again, loading: it keeps its label with a busy icon, the row opens again. */
export const SwitchRetrying: Story = {
  args: { switching: { fleet: 'Harbour', state: 'retrying' } },
  play: async ({ canvasElement }) => {
    const panel = await openPanel(canvasElement);
    const retry = within(panel).getByTestId('app-switcher-fleet-retry');
    await expect(retry).toHaveTextContent(/^Try again$/);
    await expect(retry).toHaveAttribute('aria-busy', 'true');
    await expect(fleetRow(panel, 'Harbour')).toHaveTextContent('Opening Harbour');
    await expect(within(panel).getByText('Opening Harbour…')).toBeInTheDocument();
  },
};
export const SwitchRetryingDark = inDark(SwitchRetrying);
export const SwitchRetryingPhone = onPhone(SwitchRetrying);
export const SwitchRetryingPhoneDark = inDark(onPhone(SwitchRetrying));

/** Switching fleet, arrival: the bar names Harbour, the page says "Console is open in Harbour.". */
export const Switched: Story = {
  args: { fleet: 'Harbour', hasArrived: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('app-switcher-fleet-pill')).toHaveTextContent('Harbour');
    await expect(canvas.getByTestId('arrival-line')).toHaveTextContent('Console is open in Harbour.');
  },
};
export const SwitchedDark = inDark(Switched);
export const SwitchedPhone = onPhone(Switched);
export const SwitchedPhoneDark = inDark(onPhone(Switched));

/**
 * The whole switch: choosing Harbour shows it opening before the app answers;
 * it fails, with focus on Try again; Try again is busy, then the panel
 * closes, the bar names Harbour, the page says so, and focus is on the launcher.
 */
export const SwitchFailsThenArrives: Story = {
  args: { shouldFailFirstSwitch: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const panel = await openPanel(canvasElement);
    await userEvent.click(fleetRow(panel, 'Harbour'));
    await expect(fleetRow(panel, 'Harbour')).toHaveTextContent('Opening Harbour');
    await expect(canvas.getByTestId('app-switcher-fleet-pill')).toHaveAttribute('aria-busy', 'true');
    const retry = await within(panel).findByTestId('app-switcher-fleet-retry');
    await expect(within(panel).getByRole('alert')).toHaveTextContent('Couldn’t open Harbour');
    await waitFor(() => expect(retry).toHaveFocus());
    await userEvent.click(retry);
    await expect(within(panel).getByTestId('app-switcher-fleet-retry')).toHaveAttribute('aria-busy', 'true');
    await expect(fleetRow(panel, 'Harbour')).toHaveTextContent('Opening Harbour');
    await waitFor(() => expect(screen.queryByTestId('app-switcher-panel')).toBeNull(), { timeout: 3000 });
    await expect(canvas.getByTestId('app-switcher-fleet-pill')).toHaveTextContent('Harbour');
    await expect(canvas.getByTestId('arrival-line')).toHaveTextContent('Console is open in Harbour.');
    await waitFor(() => expect(canvas.getByTestId('app-switcher-launcher')).toHaveFocus());
  },
};
export const SwitchFailsThenArrivesPhone = onPhone(SwitchFailsThenArrives);

/** A single fleet, closed: the fleet still shows. */
export const SingleFleet: Story = {
  args: { fleets: 'one' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('app-switcher-fleet-pill')).toHaveTextContent('Aeolus');
  },
};
export const SingleFleetDark = inDark(SingleFleet);
export const SingleFleetPhone = onPhone(SingleFleet);
export const SingleFleetPhoneDark = inDark(onPhone(SingleFleet));

/** A single fleet, open: the one row, checked, and why there is no other. */
export const SingleFleetOpen: Story = {
  args: { fleets: 'one' },
  play: async ({ canvasElement }) => {
    const panel = await openPanel(canvasElement);
    await expect(within(panel).getAllByTestId('app-switcher-fleet')).toHaveLength(1);
    await expect(within(panel).getByText('This is the only fleet you can open.')).toBeInTheDocument();
  },
};
export const SingleFleetOpenDark = inDark(SingleFleetOpen);
export const SingleFleetOpenPhone = onPhone(SingleFleetOpen);
export const SingleFleetOpenPhoneDark = inDark(onPhone(SingleFleetOpen));

/** Long names, closed: the fleet pill ends in an ellipsis, the full name in its title. */
export const LongName: Story = {
  args: { fleets: 'long' },
  play: async ({ canvasElement }) => {
    const pill = within(canvasElement).getByTestId('app-switcher-fleet-pill');
    await expect(pill).toHaveAttribute('title', 'Fleet: Aeolus research and development');
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};
export const LongNameDark = inDark(LongName);
export const LongNamePhone: Story = onPhone({
  ...LongName,
  play: async ({ canvasElement }) => {
    const name = within(within(canvasElement).getByTestId('app-switcher-fleet-pill')).getByText('Aeolus research and development');
    await expect(name.scrollWidth).toBeGreaterThan(name.clientWidth);
  },
});
export const LongNamePhoneDark = inDark(LongNamePhone);

/** Long names, open: the full names wrap in the panel. */
export const LongNameOpen: Story = {
  args: { fleets: 'long' },
  play: async ({ canvasElement }) => {
    const panel = await openPanel(canvasElement);
    await expect(fleetRow(panel, 'Harbour operations and logistics, northern region')).toHaveTextContent('Harbour operations and logistics, northern region');
  },
};
export const LongNameOpenDark = inDark(LongNameOpen);
export const LongNameOpenPhone = onPhone(LongNameOpen);
export const LongNameOpenPhoneDark = inDark(onPhone(LongNameOpen));

/** The account panel: who is signed in and Sign out, nothing else. */
export const Account: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('avatar-menu'));
    const signOut = await screen.findByTestId('avatar-menu-sign-out');
    await expect(screen.getByTestId('avatar-menu-signed-in-as')).toHaveTextContent('Signed in with your account');
    await expect(signOut).toHaveTextContent('Sign out');
    await expect(screen.queryByTestId('avatar-menu-theme-light')).toBeNull();
    await expect(screen.queryByTestId('avatar-menu-help')).toBeNull();
    await expect(screen.queryByTestId('app-switcher-fleet')).toBeNull();
  },
};
export const AccountDark = inDark(Account);
export const AccountPhone = onPhone(Account);
export const AccountPhoneDark = inDark(onPhone(Account));

/** Sign out: it keeps its label with a busy icon, "Signing out…" announced. */
export const SigningOut: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('avatar-menu'));
    await userEvent.click(await screen.findByTestId('avatar-menu-sign-out'));
    await expect(await screen.findByText('Signing out…')).toBeInTheDocument();
    await expect(screen.getByTestId('avatar-menu-sign-out')).toHaveTextContent('Sign out');
  },
};
export const SigningOutPhone = onPhone(SigningOut);

/** A single-app self-hosted installation: Console alone, and why. */
export const SingleApp: Story = {
  args: { limit: 'single-app' },
  play: async ({ canvasElement }) => {
    const panel = await openPanel(canvasElement);
    await expect(within(panel).getAllByTestId('app-switcher-app')).toHaveLength(1);
    await expect(within(panel).getByText('No other apps')).toBeInTheDocument();
    await expect(within(panel).getByText('Only Console is configured in this installation. There are no other apps to open.')).toBeInTheDocument();
  },
};
export const SingleAppDark = inDark(SingleApp);
export const SingleAppPhone = onPhone(SingleApp);
export const SingleAppPhoneDark = inDark(onPhone(SingleApp));

/** Signed in as argo: Console alone, why other apps need an account; the account button says how. */
export const Argo: Story = {
  args: { limit: 'argo' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('avatar-menu')).toHaveAccessibleName('Account: Signed in as argo');
    const panel = await openPanel(canvasElement);
    await expect(within(panel).getByText('This sign-in is for Console in Aeolus. Other apps require an account sign-in. Bridge does not accept an argo sign-in.')).toBeInTheDocument();
    await expect(within(panel).getByText('You can keep using this Console session.')).toBeInTheDocument();
  },
};
export const ArgoDark = inDark(Argo);
export const ArgoPhone = onPhone(Argo);
export const ArgoPhoneDark = inDark(onPhone(Argo));

/** The viewer: Console alone, why other apps are not supplied. */
export const Viewer: Story = {
  args: { limit: 'viewer' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('avatar-menu')).toHaveAccessibleName('Account: Viewer');
    const panel = await openPanel(canvasElement);
    await expect(within(panel).getByText('This viewer sign-in is for Console in Aeolus. Other apps are not supplied for this session. Bridge requires an account.')).toBeInTheDocument();
  },
};
export const ViewerDark = inDark(Viewer);
export const ViewerPhone = onPhone(Viewer);
export const ViewerPhoneDark = inDark(onPhone(Viewer));

/** A missing app: its tile greyed with no link, what failed, where you still are, and Try again; the others stay. */
export const Missing: Story = {
  args: { appAccess: { gateway: 'unavailable' } },
  play: async ({ canvasElement }) => {
    const panel = await openPanel(canvasElement);
    await expect(appTile(panel, 'Gateway')).not.toHaveAttribute('href');
    await expect(appTile(panel, 'Gateway')).toHaveAccessibleName('Gateway, Unavailable');
    await expect(within(panel).getByRole('alert')).toHaveTextContent('Couldn’t open Gateway');
    await expect(appTile(panel, 'Account')).toHaveAttribute('href');
  },
};
export const MissingDark = inDark(Missing);
export const MissingPhone = onPhone(Missing);
export const MissingPhoneDark = inDark(onPhone(Missing));

/** Try again on a missing app: busy with skeletons, then the tiles refreshed. */
export const MissingRetried: Story = {
  args: { appAccess: { gateway: 'unavailable' } },
  play: async ({ canvasElement }) => {
    const panel = await openPanel(canvasElement);
    await userEvent.click(within(panel).getByTestId('app-switcher-retry'));
    await expect(within(panel).getByTestId('app-switcher-loading')).toBeInTheDocument();
    await expect(within(panel).getByTestId('app-switcher-retry')).toHaveAttribute('aria-busy', 'true');
    await expect(await within(panel).findByText('Apps and fleets refreshed.')).toBeInTheDocument();
    await expect(appTile(panel, 'Gateway')).toHaveAttribute('href');
  },
};

/** An app's sign-in expired: its tile greyed with "Sign-in required", and Sign in; the account button says so. */
export const Expired: Story = {
  args: { appAccess: { gateway: 'sign-in-required' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('avatar-menu')).toHaveAccessibleName('Account: Sign-in expired');
    const panel = await openPanel(canvasElement);
    await expect(appTile(panel, 'Gateway')).toHaveAccessibleName('Gateway, Sign-in required');
    await expect(within(panel).getByRole('alert')).toHaveTextContent('Your sign-in has expired');
  },
};
export const ExpiredDark = inDark(Expired);
export const ExpiredPhone = onPhone(Expired);
export const ExpiredPhoneDark = inDark(onPhone(Expired));

/** Sign in, loading: it keeps its label with a busy icon. */
export const SigningIn: Story = {
  args: { appAccess: { gateway: 'sign-in-required' } },
  play: async ({ canvasElement }) => {
    const panel = await openPanel(canvasElement);
    await userEvent.click(within(panel).getByTestId('app-switcher-sign-in'));
    await expect(within(panel).getByTestId('app-switcher-sign-in')).toHaveAttribute('aria-busy', 'true');
    await expect(within(panel).getByTestId('app-switcher-sign-in')).toHaveTextContent(/^Sign in$/);
  },
};
export const SigningInPhone = onPhone(SigningIn);

/** Loading: the shape of the tiles and rows in both sections; the bar keeps the app and fleet. */
export const Loading: Story = {
  args: { read: 'loading' },
  play: async ({ canvasElement }) => {
    const panel = await openPanel(canvasElement);
    await expect(within(panel).getByText('Loading apps and fleets…')).toBeInTheDocument();
    await expect(within(panel).queryByTestId('app-switcher-app')).toBeNull();
    await expect(within(canvasElement).getByTestId('app-switcher-fleet-pill')).toHaveTextContent('Aeolus');
  },
};
export const LoadingDark = inDark(Loading);
export const LoadingPhone = onPhone(Loading);
export const LoadingPhoneDark = inDark(onPhone(Loading));

/** Read failure: one notice, the page still open, Try again. */
export const ReadFailure: Story = {
  args: { read: 'failed' },
  play: async ({ canvasElement }) => {
    const panel = await openPanel(canvasElement);
    await expect(within(panel).getByRole('alert')).toHaveTextContent('Couldn’t load apps and fleets');
    await expect(within(panel).getByText('Your current page is still open. Try again to load them.')).toBeInTheDocument();
  },
};
export const ReadFailureDark = inDark(ReadFailure);
export const ReadFailurePhone = onPhone(ReadFailure);
export const ReadFailurePhoneDark = inDark(onPhone(ReadFailure));

/** Try again after a read failure: busy, the shapes, then both sections and "Apps and fleets refreshed.". */
export const ReadRetried: Story = {
  args: { read: 'failed' },
  play: async ({ canvasElement }) => {
    const panel = await openPanel(canvasElement);
    await userEvent.click(within(panel).getByTestId('app-switcher-retry'));
    await expect(within(panel).getByTestId('app-switcher-retry')).toHaveAttribute('aria-busy', 'true');
    await expect(within(panel).getByText('Loading apps and fleets…')).toBeInTheDocument();
    await expect(await within(panel).findByText('Apps and fleets refreshed.')).toBeInTheDocument();
    await expect(within(panel).getAllByTestId('app-switcher-fleet')).toHaveLength(2);
  },
};
export const ReadRetriedPhone = onPhone(ReadRetried);

/** Try again, loading, as the mockups draw it. */
export const Retrying: Story = { args: { read: 'retrying' }, play: async ({ canvasElement }) => {
  const panel = await openPanel(canvasElement);
  await expect(within(panel).getByTestId('app-switcher-retry')).toHaveAttribute('aria-busy', 'true');
} };
export const RetryingPhone = onPhone(Retrying);

/** Apps and fleets refreshed. */
export const Refreshed: Story = { args: { read: 'refreshed' }, play: async ({ canvasElement }) => {
  const panel = await openPanel(canvasElement);
  await expect(within(panel).getByText('Apps and fleets refreshed.')).toBeInTheDocument();
} };
export const RefreshedPhone = onPhone(Refreshed);

/** Opening an app: its tile says "Opening" with a busy icon at once, the rest waits, "Opening Gateway…" under the tiles. */
export const OpeningApp: Story = {
  play: async ({ canvasElement }) => {
    const panel = await openPanel(canvasElement);
    await userEvent.click(appTile(panel, 'Gateway'));
    await expect(appTile(panel, 'Gateway')).toHaveAccessibleName('Opening Gateway');
    await expect(within(panel).getByText('Opening Gateway…')).toBeInTheDocument();
    await expect(appTile(panel, 'Account')).toHaveAttribute('aria-disabled', 'true');
    await expect(fleetRow(panel, 'Harbour')).toHaveAttribute('aria-disabled', 'true');
  },
};
export const OpeningAppPhone = onPhone(OpeningApp);

/** A detail page keeps the same bar: the launcher and the account button. */
export const Detail: Story = {
  args: { isDetail: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('app-switcher-launcher')).toBeInTheDocument();
    await expect(within(canvasElement).getByTestId('avatar-menu')).toBeInTheDocument();
  },
};
export const DetailDark = inDark(Detail);
export const DetailPhone = onPhone(Detail);
export const DetailPhoneDark = inDark(onPhone(Detail));
