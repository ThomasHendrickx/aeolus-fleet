// Playwright's provider gives vitest/browser's cdp() its send (ReducedMotion below).
/// <reference types="@vitest/browser-playwright" />
import type { HarbourState } from '@aeolus-fleet/common/rules';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { HarbourTile, type HarbourTileShip } from './harbour-tile.js';

const NOW = new Date('2026-11-03T12:00:00.000Z');

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

const ALERT: HarbourTileShip = { id: 'shp_alert', name: 'ecosystem-relationships', state: 'alert', note: 'No report change for 2 h', lastActivityAt: minutesAgo(120) };
const AWAITING_CREW: HarbourTileShip = { id: 'shp_awaiting', name: 'walker-3', state: 'awaitingCrew', note: 'Awaiting crew', lastActivityAt: null };
const BLOCKED: HarbourTileShip = { id: 'shp_blocked', name: 'builder-gateway', state: 'blocked', note: 'Blocked: waiting for release 0.37.0', lastActivityAt: minutesAgo(25) };
const WORKING: HarbourTileShip = { id: 'shp_working', name: 'orchestrator-1', state: 'working', note: 'Cutting #189 into slices', lastActivityAt: minutesAgo(0) };
const IDLE: HarbourTileShip = { id: 'shp_idle', name: 'company-memory', state: 'idle', note: 'Last call: search', lastActivityAt: minutesAgo(40) };

const meta = {
  title: 'Harbour/HarbourTile',
  component: HarbourTile,
  args: { ship: WORKING, kind: 'agents', href: '#ship', now: NOW },
  decorators: [
    (Story) => (
      <div className="w-58">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HarbourTile>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The tile's state as ShipState draws it: its word, its icon and the tone that means it (docs/design/state-colours). */
async function expectState(canvasElement: HTMLElement, { word, tone }: { word: string; tone: string }) {
  const state = within(within(canvasElement).getByTestId('harbour-tile')).getByTestId('ship-state');
  await expect(state).toHaveTextContent(word);
  await expect(state.querySelector('svg')).not.toBeNull();
  await expect(state).toHaveAttribute('data-tone', tone);
}

/** Alert: filled in attention, Coral. */
export const Alert: Story = { args: { ship: ALERT }, play: async ({ canvasElement }) => expectState(canvasElement, { word: 'Alert', tone: 'attention' }) };

/** Awaiting crew: filled in waiting, Amber. */
export const AwaitingCrew: Story = { args: { ship: AWAITING_CREW }, play: async ({ canvasElement }) => expectState(canvasElement, { word: 'Awaiting crew', tone: 'waiting' }) };

/** Blocked: filled in blocked, violet. */
export const Blocked: Story = { args: { ship: BLOCKED }, play: async ({ canvasElement }) => expectState(canvasElement, { word: 'Blocked', tone: 'blocked' }) };

/** Working: filled in active, Sea, with the live band. */
export const Working: Story = {
  args: { ship: WORKING },
  play: async ({ canvasElement }) => {
    await expectState(canvasElement, { word: 'Working', tone: 'active' });
    await expect(within(canvasElement).getByTestId('harbour-tile-live')).toBeInTheDocument();
  },
};

/** Idle stays plain and carries no tone, so colour marks only what is going on. */
export const Idle: Story = { args: { ship: IDLE, kind: 'gateway' }, play: async ({ canvasElement }) => expectState(canvasElement, { word: 'Idle', tone: 'none' }) };

/** The five side by side, light and dark, as the sheet draws Harbour's cards. */
export const LightAndDark: Story = {
  decorators: [(Story) => <Story />],
  render: () => (
    <div className="grid grid-cols-2">
      {(['', 'dark'] as const).map((mode) => (
        <div key={mode || 'light'} className={`${mode} grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2 bg-background p-4 text-foreground`}>
          {[ALERT, BLOCKED, AWAITING_CREW, WORKING, IDLE].map((ship) => (
            <HarbourTile key={ship.id} ship={ship} kind="agents" href="#ship" now={NOW} />
          ))}
        </div>
      ))}
    </div>
  ),
};

/** A person's tile carries the person icon. */
export const Person: Story = { args: { ship: { id: 'shp_thomas', name: 'thomas', state: 'awaitingCrew', note: '4 wait on you', lastActivityAt: minutesAgo(12) }, kind: 'people' } };

/** A plugin's tile. */
export const Plugin: Story = { args: { ship: { id: 'shp_squadrons', name: 'squadrons', state: 'working', note: 'design-sq: 3 on station', lastActivityAt: minutesAgo(1) }, kind: 'plugins' } };

/** The whole name wraps rather than being cut; a long note keeps two lines. */
export const LongNameAndNote: Story = {
  args: {
    ship: {
      id: 'shp_long',
      name: 'thomas-hendrickx1989-with-a-very-long-ship-name',
      state: 'idle',
      note: 'Signed in, nothing open, and a note long enough to need more than the two lines a tile gives it',
      lastActivityAt: minutesAgo(24 * 60 + 5),
    },
    kind: 'people',
  },
};

/** Before it reports: no note, and No activity yet. */
export const NoActivityYet: Story = {
  args: { ship: { id: 'shp_walker', name: 'walker-3', state: 'awaitingCrew', note: null, lastActivityAt: null } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('harbour-tile-age')).toHaveTextContent('No activity yet');
    await expect(within(canvasElement).getByTestId('harbour-tile')).toHaveAttribute('title', 'walker-3: Awaiting crew');
  },
};

/** Six days ago: still counted in days. */
export const SixDaysAgo: Story = { args: { ship: { ...IDLE, name: 'aeolus-guide', note: 'Nothing open', lastActivityAt: minutesAgo(6 * 24 * 60 + 23 * 60) } } };
/** From a week on: the date. */
export const OlderThanAWeek: Story = { args: { ship: { ...IDLE, name: 'aeolus-guide', note: 'Nothing open', lastActivityAt: minutesAgo(6 * 24 * 60 + 12 * 60 + 24 * 60) } } };

/** With an href it is a link to the ship's page. */
export const Link: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link', { name: /orchestrator-1/ })).toHaveAttribute('href', '#ship');
  },
};

/** Without one it is not a link: no arrow, no lift. */
export const NotALink: Story = {
  args: { href: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('link')).toBeNull();
  },
};

/** Keyboard focus: the ring, and the arrow shows. */
export const KeyboardFocus: Story = {
  play: async ({ canvasElement }) => {
    within(canvasElement).getByRole('link').focus();
    await expect(within(canvasElement).getByRole('link')).toHaveFocus();
  },
};

/** The five states in the order a ship's state can change between them. */
const STATES = ['alert', 'awaitingCrew', 'blocked', 'working', 'idle'] as const satisfies readonly HarbourState[];

/** One ship whose state changes, as a live update hands Harbour the same keyed tile with a new state. Story-only buttons stand in for the update. */
function ChangingTile({ href }: { href?: string }) {
  const [state, setState] = useState<HarbourState>('working');
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-1">
        {STATES.map((next) => (
          <button
            key={next}
            type="button"
            data-testid={`harbour-tile-story-${next}`}
            className="rounded-sm border px-2 text-caption"
            onClick={() => {
              setState(next);
            }}
          >
            {next}
          </button>
        ))}
      </div>
      <HarbourTile ship={{ ...WORKING, state }} kind="agents" href={href} now={NOW} />
    </div>
  );
}

/** The live band's running animation, paused at a moment of its loop, as the browser draws that frame. */
function bandFrameAt(band: HTMLElement, milliseconds: number): { opacity: number; offset: number } {
  const [animation] = band.getAnimations();
  if (animation === undefined) {
    throw new Error('the live band runs no animation');
  }
  animation.pause();
  animation.currentTime = milliseconds;
  const style = getComputedStyle(band);
  // The band's own translation, as a share of its width: -1 wholly left of the tile, 1 wholly right.
  return { opacity: Number(style.opacity), offset: new DOMMatrixReadOnly(style.transform).m41 / band.offsetWidth };
}

/** Where the tile sits and how big it is. */
function boundsOf(element: Element): Pick<DOMRect, 'x' | 'y' | 'width' | 'height'> {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
}

function colourTransitionsOf(element: Element): CSSTransition[] {
  return element.getAnimations().filter((animation): animation is CSSTransition => animation instanceof CSSTransition);
}

/** A colour as the browser resolves a class to it, to compare a settled tile against. */
function colourOf(className: string, property: 'backgroundColor' | 'borderTopColor'): string {
  const probe = document.createElement('div');
  probe.className = className;
  document.body.append(probe);
  const colour = getComputedStyle(probe)[property];
  probe.remove();
  return colour;
}

/** A state's colours settle: 180 ms ease-out (docs/design/working-band). */
const SETTLING = { duration: 180, easing: 'ease-out' } as const;

/** A link's hover and press keep their control timing: --duration-fast on Tailwind's default curve. */
const CONTROL = { duration: 150, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' } as const;

/** Every transition the tile runs now has this timing, and there is at least one. */
async function expectTransitionsOf(tile: Element, timing: { duration: number; easing: string }): Promise<void> {
  const transitions = colourTransitionsOf(tile);
  await expect(transitions.length).toBeGreaterThan(0);
  for (const transition of transitions) {
    await expect(transition.effect?.getTiming(), transition.transitionProperty).toMatchObject(timing);
  }
}

/** The tile's background and border as drawn with every running transition paused at this moment. */
function frameAt(tile: HTMLElement, milliseconds: number): { background: string; border: string } {
  const transitions = colourTransitionsOf(tile);
  for (const transition of transitions) {
    transition.pause();
    transition.currentTime = milliseconds;
  }
  const style = getComputedStyle(tile);
  const frame = { background: style.backgroundColor, border: style.borderTopColor };
  for (const transition of transitions) {
    transition.play();
  }
  return frame;
}

/** Until the tile runs no transition. */
async function settled(tile: Element): Promise<void> {
  await waitFor(() => expect(colourTransitionsOf(tile)).toEqual([]));
}

/** The browser's own pointer, not synthetic events, so :hover and :active apply: Playwright's in the stories' test run. */
async function realPointer() {
  const { userEvent: pointer, cdp } = await import('vitest/browser');
  /** The element's centre in the top page, through the test run's frames. */
  const centreOf = (element: Element) => {
    const box = element.getBoundingClientRect();
    let x = box.left + box.width / 2;
    let y = box.top + box.height / 2;
    for (let frame: Window = window; frame.frameElement !== null; frame = frame.parent) {
      const offset = frame.frameElement.getBoundingClientRect();
      x += offset.left;
      y += offset.top;
    }
    return { x, y };
  };
  const mouse = async (type: 'mousePressed' | 'mouseReleased', element: Element) => {
    await cdp().send('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, ...centreOf(element) });
  };
  return {
    hover: (element: Element) => pointer.hover(element),
    unhover: (element: Element) => pointer.unhover(element),
    press: (element: Element) => mouse('mousePressed', element),
    release: (element: Element) => mouse('mouseReleased', element),
    keyboard: (keys: string) => pointer.keyboard(keys),
  };
}

/** Reduced motion as the OS asks for it, through Chromium's own emulation in the stories' test run. */
async function emulateReducedMotion(value: 'reduce' | 'no-preference'): Promise<void> {
  // Imported when called: vitest/browser exists only in the test run, so the story using it is hidden from Storybook's own sidebar.
  const { cdp } = await import('vitest/browser');
  await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value }] });
}

/** A working ship's band sweeps for 2.4 s, rests unseen for 1.4 s, and starts again: 3.8 s a loop, at most .45 (docs/design/working-band, "Concrete motion"). */
export const WorkingBandLoop: Story = {
  play: async ({ canvasElement }) => {
    const band = within(canvasElement).getByTestId('harbour-tile-live');
    const [animation] = band.getAnimations();
    await expect(animation?.effect?.getComputedTiming()).toMatchObject({ duration: 3800, iterations: Infinity });
    await expect(getComputedStyle(band).animationTimingFunction).toBe('linear');

    const frames = [0, 380, 1200, 2400, 3100, 3800].map((milliseconds) => ({ milliseconds, ...bandFrameAt(band, milliseconds) }));

    const expected = [
      { milliseconds: 0, opacity: 0, offset: -1 },
      { milliseconds: 380, opacity: 0.45, offset: -0.6833 },
      { milliseconds: 1200, opacity: 0.2673, offset: 0 },
      { milliseconds: 2400, opacity: 0, offset: 1 },
      { milliseconds: 3100, opacity: 0, offset: 1 },
      { milliseconds: 3800, opacity: 0, offset: -1 },
    ];
    for (const [index, frame] of frames.entries()) {
      await expect(frame.opacity, `opacity at ${String(frame.milliseconds)} ms`).toBeCloseTo(expected[index]?.opacity ?? Number.NaN, 2);
      await expect(frame.offset, `offset at ${String(frame.milliseconds)} ms`).toBeCloseTo(expected[index]?.offset ?? Number.NaN, 2);
    }
  },
};

/**
 * A state change: the word, icon and band change at once, the colours settle
 * over 180 ms ease-out, toward the latest state when changes come fast, and
 * the tile neither moves nor changes size (docs/design/working-band).
 */
export const StateChangeSettlesColours: Story = {
  render: () => <ChangingTile href="#ship" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tile = canvas.getByTestId('harbour-tile');
    const bounds = boundsOf(tile);
    const workingBackground = getComputedStyle(tile).backgroundColor;
    const workingBorder = getComputedStyle(tile).borderTopColor;

    await userEvent.click(canvas.getByTestId('harbour-tile-story-idle'));

    await expect(within(tile).getByTestId('ship-state')).toHaveTextContent('Idle');
    await expect(within(tile).queryByTestId('harbour-tile-live')).toBeNull();
    await expect(boundsOf(tile)).toEqual(bounds);
    await expect(getComputedStyle(tile).transform).toBe('none');
    await expectTransitionsOf(tile, SETTLING);
    await expect(colourTransitionsOf(within(tile).getByTestId('ship-state')).map((transition) => transition.effect?.getTiming().duration)).toEqual([180]);

    const halfway = frameAt(tile, 90);
    await expect(halfway.background).not.toBe(workingBackground);
    await expect(halfway.background).not.toBe(colourOf('bg-card', 'backgroundColor'));
    await expect(halfway.border).not.toBe(workingBorder);
    await expect(halfway.border).not.toBe(colourOf('border-border', 'borderTopColor'));

    await userEvent.click(canvas.getByTestId('harbour-tile-story-alert'));
    await userEvent.click(canvas.getByTestId('harbour-tile-story-blocked'));

    await expect(within(tile).getByTestId('ship-state')).toHaveTextContent('Blocked');
    await waitFor(() => expect(colourTransitionsOf(tile)).toEqual([]));
    await expect(getComputedStyle(tile).backgroundColor).toBe(colourOf('bg-tone-blocked-bg', 'backgroundColor'));
    await expect(getComputedStyle(tile).borderTopColor).toBe(colourOf('border-tone-blocked-border', 'borderTopColor'));
    await expect(boundsOf(tile)).toEqual(bounds);
  },
};

/** Entering Working, the band starts a fresh loop from its first frame. */
export const EnteringWorkingStartsFreshLoop: Story = {
  render: () => <ChangingTile href="#ship" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('harbour-tile-story-awaitingCrew'));

    await userEvent.click(canvas.getByTestId('harbour-tile-story-working'));

    const [animation] = canvas.getByTestId('harbour-tile-live').getAnimations();
    await expect(Number(animation?.currentTime)).toBeLessThan(380);
  },
};

/**
 * Reduced motion: no sweep and no settling. A working tile's foot is a still
 * band of Sea at .45; every state change shows its final colours at once.
 */
export const ReducedMotion: Story = {
  tags: ['!dev'],
  render: () => <ChangingTile href="#ship" />,
  play: async ({ canvasElement }) => {
    await emulateReducedMotion('reduce');
    try {
      const canvas = within(canvasElement);
      const tile = canvas.getByTestId('harbour-tile');
      const band = canvas.getByTestId('harbour-tile-live');
      const bounds = boundsOf(tile);

      await expect(band.getAnimations()).toEqual([]);
      const foot = getComputedStyle(band);
      await expect({ opacity: foot.opacity, image: foot.backgroundImage, colour: foot.backgroundColor, transform: foot.transform }).toEqual({
        opacity: '0.45',
        image: 'none',
        colour: colourOf('bg-live-band', 'backgroundColor'),
        transform: 'none',
      });

      await userEvent.click(canvas.getByTestId('harbour-tile-story-blocked'));

      await expect(within(tile).getByTestId('ship-state')).toHaveTextContent('Blocked');
      await expect(within(tile).queryByTestId('harbour-tile-live')).toBeNull();
      await expect(tile.getAnimations({ subtree: true })).toEqual([]);
      await expect(getComputedStyle(tile).backgroundColor).toBe(colourOf('bg-tone-blocked-bg', 'backgroundColor'));
      await expect(boundsOf(tile)).toEqual(bounds);
    } finally {
      await emulateReducedMotion('no-preference');
    }
  },
};

/**
 * A link tile's hover and press keep their own timing while its state colours
 * settle: pointer in and out and press and release run 150 ms on the standard
 * curve, a state change under the pointer settles in 180 ms (#1755).
 */
export const HoverAndPressKeepControlTiming: Story = {
  tags: ['!dev'],
  render: () => <ChangingTile href="#ship" />,
  play: async ({ canvasElement }) => {
    const pointer = await realPointer();
    const canvas = within(canvasElement);
    const tile = canvas.getByTestId('harbour-tile');
    const restingBorder = getComputedStyle(tile).borderTopColor;

    await pointer.hover(tile);

    await expectTransitionsOf(tile, CONTROL);
    await expect(frameAt(tile, 75).border).not.toBe(restingBorder);
    await settled(tile);
    const hoverBorder = getComputedStyle(tile).borderTopColor;
    await expect(hoverBorder).toBe(colourOf('border-tone-active-fg', 'borderTopColor'));

    await pointer.press(tile);

    await expect(tile.matches(':active')).toBe(true);
    await expectTransitionsOf(tile, CONTROL);
    await settled(tile);
    await expect(getComputedStyle(tile).borderTopColor).toBe(hoverBorder);

    await pointer.release(tile);

    await expectTransitionsOf(tile, CONTROL);
    await settled(tile);

    canvas.getByTestId('harbour-tile-story-blocked').focus();
    await pointer.keyboard('{Enter}');

    await expect(tile.matches(':hover')).toBe(true);
    await expect(within(tile).getByTestId('ship-state')).toHaveTextContent('Blocked');
    await expectTransitionsOf(tile, SETTLING);
    await expect(frameAt(tile, 90).border).not.toBe(hoverBorder);
    await settled(tile);
    await expect(getComputedStyle(tile).borderTopColor).toBe(colourOf('border-tone-blocked-fg', 'borderTopColor'));

    await pointer.unhover(tile);

    await expectTransitionsOf(tile, CONTROL);
    await settled(tile);
    await expect(getComputedStyle(tile).borderTopColor).toBe(colourOf('border-tone-blocked-border', 'borderTopColor'));
  },
};

/** Reduced motion: hover and press change the border at once, as a state change does. */
export const ReducedMotionHover: Story = {
  tags: ['!dev'],
  render: () => <ChangingTile href="#ship" />,
  play: async ({ canvasElement }) => {
    await emulateReducedMotion('reduce');
    try {
      const pointer = await realPointer();
      const tile = within(canvasElement).getByTestId('harbour-tile');

      await pointer.hover(tile);

      await expect(tile.getAnimations()).toEqual([]);
      await expect(getComputedStyle(tile).borderTopColor).toBe(colourOf('border-tone-active-fg', 'borderTopColor'));

      await pointer.unhover(tile);

      await expect(tile.getAnimations()).toEqual([]);
    } finally {
      await emulateReducedMotion('no-preference');
    }
  },
};
