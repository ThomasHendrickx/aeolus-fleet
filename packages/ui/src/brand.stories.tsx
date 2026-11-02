import type { Meta, StoryObj } from '@storybook/react-vite';
import type { CSSProperties, ReactNode } from 'react';
import { expect, within } from 'storybook/test';

import './brand.css';
import './brand.stories.css';

type Mode = 'light' | 'dark';

/** A colour token, with the brandbook's name and use for it in each mode, and the token its label is written in. */
interface Swatch {
  readonly token: string;
  readonly name: Record<Mode, string>;
  readonly use: Record<Mode, string>;
  readonly label: Record<Mode, string>;
}

const palette: readonly Swatch[] = [
  {
    token: '--brand-slate',
    name: { light: 'Slate', dark: 'Light slate' },
    use: {
      light: 'Primary, the mark, primary buttons',
      dark: 'Primary on navy',
    },
    label: { light: '--brand-surface', dark: '--brand-ground' },
  },
  {
    token: '--brand-text',
    name: { light: 'Ink', dark: 'Frost' },
    use: { light: 'Text', dark: 'Text' },
    label: { light: '--brand-surface', dark: '--brand-ground' },
  },
  {
    token: '--brand-text-secondary',
    name: { light: 'Muted', dark: 'Haze' },
    use: { light: 'Secondary text', dark: 'Secondary text' },
    label: { light: '--brand-surface', dark: '--brand-ground' },
  },
  {
    token: '--brand-line',
    name: { light: 'Line', dark: 'Line' },
    use: { light: 'Borders, dividers', dark: 'Borders, dividers' },
    label: { light: '--brand-text', dark: '--brand-text' },
  },
  {
    token: '--brand-ground',
    name: { light: 'Mist', dark: 'Navy' },
    use: { light: 'Page ground', dark: 'Page ground' },
    label: { light: '--brand-text', dark: '--brand-text' },
  },
  {
    token: '--brand-surface',
    name: { light: 'White', dark: 'Deep' },
    use: { light: 'Surfaces', dark: 'Surfaces' },
    label: { light: '--brand-text', dark: '--brand-text' },
  },
];

const meanings: readonly Swatch[] = [
  {
    token: '--brand-sea',
    name: { light: 'Sea', dark: 'Sea' },
    use: {
      light: 'Live and active, nothing else',
      dark: 'Live and active, nothing else',
    },
    label: { light: '--brand-text', dark: '--brand-ground' },
  },
  {
    token: '--brand-coral',
    name: { light: 'Coral', dark: 'Coral' },
    use: { light: 'Alerts only', dark: 'Alerts only' },
    label: { light: '--brand-text', dark: '--brand-ground' },
  },
  {
    token: '--brand-coral-text',
    name: { light: 'Coral text', dark: 'Coral text' },
    use: { light: 'Alert text on light', dark: 'Alert text on light' },
    label: { light: '--brand-surface', dark: '--brand-text' },
  },
  {
    token: '--brand-amber',
    name: { light: 'Amber', dark: 'Amber' },
    use: { light: 'Waiting on a person', dark: 'Waiting on a person' },
    label: { light: '--brand-text', dark: '--brand-ground' },
  },
];

/** A timing, the tokens it spans and the brandbook's line for it, with a demo that moves by it. */
interface Timing {
  readonly name: string;
  readonly tokens: readonly string[];
  readonly use: string;
  readonly demo: CSSProperties;
}

const timings: readonly Timing[] = [
  {
    name: 'Event',
    tokens: ['--brand-event-min', '--brand-event-max'],
    use: 'A message travelling, a name lighting up. Once, then rests.',
    demo: {
      animation: 'brand-across calc(2 * var(--brand-event-max)) var(--brand-glide) var(--brand-loop)',
    },
  },
  {
    name: 'Breath',
    tokens: ['--brand-breath-min', '--brand-breath-max'],
    use: 'The bob, an amber ring waiting.',
    demo: {
      animation: 'brand-breathe var(--brand-breath-min) var(--brand-sway) var(--brand-loop)',
    },
  },
  {
    name: 'Story',
    tokens: ['--brand-story-min', '--brand-story-max'],
    use: 'A flow like the story demo. Plays when seen, tap to replay.',
    demo: {
      animation: 'brand-across calc(2 * var(--brand-story-min)) var(--brand-glide) var(--brand-loop)',
    },
  },
  {
    name: 'Drift',
    tokens: ['--brand-drift-min', '--brand-drift-max'],
    use: 'Glints on the water. Felt more than seen.',
    demo: {
      animation: 'brand-back-and-forth var(--brand-drift-min) var(--brand-steady) var(--brand-loop)',
    },
  },
  {
    name: 'Urgent',
    tokens: ['--brand-urgent'],
    use: 'Only for alerts. Coral never keeps blinking.',
    demo: {
      background: 'var(--brand-coral)',
      animation: 'brand-pulse var(--brand-urgent) var(--brand-sway) 1',
    },
  },
];

const easings: readonly Timing[] = [
  {
    name: 'Settle',
    tokens: ['--brand-settle'],
    use: 'A name lighting up, a ring settling.',
    demo: {
      animation: 'brand-across calc(2 * var(--brand-event-max)) var(--brand-settle) var(--brand-loop)',
    },
  },
  {
    name: 'Glide',
    tokens: ['--brand-glide'],
    use: 'A message travelling between ships.',
    demo: {
      animation: 'brand-across calc(2 * var(--brand-event-max)) var(--brand-glide) var(--brand-loop)',
    },
  },
  {
    name: 'Sway',
    tokens: ['--brand-sway'],
    use: 'The bob, an amber ring breathing.',
    demo: {
      animation: 'brand-back-and-forth var(--brand-breath-min) var(--brand-sway) var(--brand-loop)',
    },
  },
  {
    name: 'Steady',
    tokens: ['--brand-steady'],
    use: 'Glints drifting, a line that keeps time.',
    demo: {
      animation: 'brand-across calc(2 * var(--brand-event-max)) var(--brand-steady) var(--brand-loop)',
    },
  },
];

/** A token's value as the page resolves it, so the story never holds a second copy of it. */
function TokenValue({ token }: { token: string }) {
  return (
    <code
      data-token={token}
      className="font-(family-name:--brand-font-mono) text-xs"
      ref={(element) => {
        if (element) element.textContent = getComputedStyle(element).getPropertyValue(token).trim();
      }}
    />
  );
}

/** Two tokens as the brandbook writes a range: "44px to 72px". */
function TokenRange({ tokens }: { tokens: readonly string[] }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-1">
      {tokens.map((token, position) => (
        <span key={token} className="inline-flex items-baseline gap-1">
          {position > 0 && <span className="text-xs">to</span>}
          <TokenValue token={token} />
        </span>
      ))}
    </span>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2.5 text-xs font-semibold tracking-[.12em] text-(--brand-text-secondary) uppercase">
      {children}
    </div>
  );
}

function SectionHead({ number, title }: { number: number; title: string }) {
  return (
    <div className="mb-5 flex items-baseline gap-3.5 border-t border-(--brand-line) pt-10">
      <span className="font-(family-name:--brand-font-display) text-[44px] leading-none font-extrabold text-(--brand-slate)">
        {number}
      </span>
      <h2 className="font-(family-name:--brand-font-display) text-[38px] leading-tight font-bold">{title}</h2>
    </div>
  );
}

function Swatches({ swatches, mode }: { swatches: readonly Swatch[]; mode: Mode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2.5">
      {swatches.map((swatch) => (
        <div
          key={swatch.token}
          data-testid={`brand-swatch-${swatch.token.slice('--brand-'.length)}`}
          className="flex min-h-26 flex-col justify-end rounded-2xl border border-[rgb(20_32_51/.08)] p-3.5"
          style={{
            background: `var(${swatch.token})`,
            color: `var(${swatch.label[mode]})`,
          }}
        >
          <b className="block font-(family-name:--brand-font-display) text-[17px] font-bold">{swatch.name[mode]}</b>
          <span className="opacity-85">
            <TokenValue token={swatch.token} />
          </span>
          <small className="text-xs opacity-85">{swatch.use[mode]}</small>
          <small className="font-(family-name:--brand-font-mono) text-[11px] opacity-70">{swatch.token}</small>
        </div>
      ))}
    </div>
  );
}

function Colour({ mode }: { mode: Mode }) {
  return (
    <section>
      <SectionHead number={3} title="Colour" />
      <Eyebrow>{mode === 'light' ? 'Light' : 'Dark'}</Eyebrow>
      <Swatches swatches={palette} mode={mode} />
      <div className="mt-5.5">
        <Eyebrow>Meaning, both modes</Eyebrow>
        <Swatches swatches={meanings} mode={mode} />
      </div>
    </section>
  );
}

/** A step of the type scale, its sample set in the step's own tokens. */
function ScaleStep({ sample, name, children }: { sample: ReactNode; name: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3 border-b border-(--brand-line) py-2.5">
      <dt className="m-0 leading-none">{sample}</dt>
      <dd className="m-0 text-sm text-(--brand-text-secondary)">
        <b className="block font-semibold text-(--brand-text)">{name}</b>
        {children}
      </dd>
    </div>
  );
}

function Type() {
  return (
    <section>
      <SectionHead number={4} title="Type" />
      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2 rounded-[18px] border border-(--brand-line) bg-(--brand-surface) p-5">
          <p className="m-0 font-(family-name:--brand-font-display) text-(length:--brand-heading-size-max) leading-[1.05] font-bold tracking-[-.01em] text-balance">
            All quiet in the harbour.
          </p>
          <p className="m-0 font-(family-name:--brand-font-display) text-(length:--brand-heading-size-min) font-bold text-(--brand-slate)">
            12 ships at sea
          </p>
          <p className="m-0 font-(family-name:--brand-font-text) text-(length:--brand-text-size-min) text-(--brand-text-secondary)">
            Every wind reaches the ship it was meant for. Nothing to do here until the next one lands.
          </p>
          <p className="m-0 font-(family-name:--brand-font-mono) text-[13px] text-(--brand-text-secondary)">
            reviewer-2 &nbsp; delivered &nbsp; 14:02
          </p>
        </div>
        <dl className="m-0 grid">
          <ScaleStep
            name="Display"
            sample={
              <span
                className="font-(family-name:--brand-font-display) text-[44px]"
                style={{ fontWeight: 'var(--brand-display-weight)' }}
              >
                Aa
              </span>
            }
          >
            <TokenValue token="--brand-display-weight" />,{' '}
            <TokenRange tokens={['--brand-display-size-min', '--brand-display-size-max']} />
          </ScaleStep>
          <ScaleStep
            name="Heading"
            sample={
              <span
                className="font-(family-name:--brand-font-display) text-[30px]"
                style={{ fontWeight: 'var(--brand-heading-weight)' }}
              >
                Aa
              </span>
            }
          >
            <TokenValue token="--brand-heading-weight" />,{' '}
            <TokenRange tokens={['--brand-heading-size-min', '--brand-heading-size-max']} />
          </ScaleStep>
          <ScaleStep
            name="Number"
            sample={
              <span
                className="font-(family-name:--brand-font-display) text-[30px] text-(--brand-slate)"
                style={{ fontWeight: 'var(--brand-number-weight)' }}
              >
                12
              </span>
            }
          >
            <TokenValue token="--brand-number-weight" />, the count is the hero.
          </ScaleStep>
          <ScaleStep name="Text" sample={<span className="font-(family-name:--brand-font-text) text-lg">Aa</span>}>
            <TokenRange tokens={['--brand-text-weight-min', '--brand-text-weight-max']} />,{' '}
            <TokenRange tokens={['--brand-text-size-min', '--brand-text-size-max']} />
          </ScaleStep>
          <ScaleStep name="Mono" sample={<span className="font-(family-name:--brand-font-mono) text-[15px]">a-2</span>}>
            Ship names, ids, times.
          </ScaleStep>
        </dl>
      </div>
      <dl className="mt-3.5 grid gap-1 text-sm text-(--brand-text-secondary)">
        {['--brand-font-display', '--brand-font-text', '--brand-font-mono'].map((token) => (
          <div key={token} className="flex flex-wrap gap-x-3">
            <dt className="font-(family-name:--brand-font-mono) text-xs text-(--brand-text)">{token}</dt>
            <dd className="m-0">
              <TokenValue token={token} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Demo({ style }: { style: CSSProperties }) {
  return (
    <span className="brand-demo block">
      <i style={style} />
    </span>
  );
}

function Motion() {
  return (
    <section>
      <SectionHead number={5} title="Motion" />
      <Eyebrow>Timing, at real speed</Eyebrow>
      <div className="grid gap-2.5">
        {timings.map((timing) => (
          <div
            key={timing.name}
            className="grid grid-cols-[90px_minmax(0,1fr)] items-center gap-3.5 border-b border-(--brand-line) py-2 sm:grid-cols-[minmax(0,1.2fr)_90px_150px_minmax(0,2fr)]"
          >
            <span className="col-span-full sm:col-span-1">
              <Demo style={timing.demo} />
            </span>
            <b className="font-(family-name:--brand-font-display) text-[17px] font-bold">{timing.name}</b>
            <span className="text-(--brand-text-secondary)">
              <TokenRange tokens={timing.tokens} />
            </span>
            <span className="col-span-full text-sm text-(--brand-text-secondary) sm:col-span-1">{timing.use}</span>
          </div>
        ))}
      </div>
      <div className="mt-7.5">
        <Eyebrow>Easing: the same move, four feels</Eyebrow>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3.5">
          {easings.map((easing) => (
            <div
              key={easing.name}
              className="grid min-w-0 gap-2 rounded-2xl border border-(--brand-line) bg-(--brand-surface) p-4"
            >
              <b className="font-(family-name:--brand-font-display) text-lg font-bold">{easing.name}</b>
              <Demo style={easing.demo} />
              <span className="text-sm text-(--brand-text-secondary)">{easing.use}</span>
              <span className="text-(--brand-text-secondary)">
                <TokenRange tokens={easing.tokens} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Every brand token in one mode, laid out as the brandbook's Colour, Type and Motion sections. */
function BrandTokens({ mode }: { mode: Mode }) {
  return (
    <div
      data-testid={`brand-tokens-${mode}`}
      className={`${mode === 'dark' ? 'dark ' : ''}min-w-0 bg-(--brand-ground) px-5 pb-10 font-(family-name:--brand-font-text) text-(--brand-text) sm:px-8`}
    >
      <Colour mode={mode} />
      <Type />
      <Motion />
    </div>
  );
}

const meta = {
  title: 'Brand/Tokens',
  component: BrandTokens,
  // Each mode paints its own ground, edge to edge.
  decorators: [
    (Story) => (
      <div className="-m-6">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof BrandTokens>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Light, on Mist. */
export const Light: Story = {
  args: { mode: 'light' },
  play: async ({ canvasElement }) => {
    await expectEveryTokenSet(canvasElement, 'light');
  },
};

/** Dark navy, its own palette. */
export const Dark: Story = {
  args: { mode: 'dark' },
  play: async ({ canvasElement }) => {
    await expectEveryTokenSet(canvasElement, 'dark');
  },
};

/** Both modes side by side, each token beside its other self. */
export const LightAndDark: Story = {
  args: { mode: 'light' },
  render: () => (
    <div className="grid lg:grid-cols-2">
      <BrandTokens mode="light" />
      <BrandTokens mode="dark" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expectEveryTokenSet(canvasElement, 'light');
    await expectEveryTokenSet(canvasElement, 'dark');
    const canvas = within(canvasElement);
    const slate = (mode: Mode) =>
      getComputedStyle(within(canvas.getByTestId(`brand-tokens-${mode}`)).getByTestId('brand-swatch-slate'))
        .backgroundColor;
    await expect(slate('dark')).not.toBe(slate('light'));
  },
};

/** Every token in the mode's panel resolves to a value, and every swatch shows it. */
async function expectEveryTokenSet(canvasElement: HTMLElement, mode: Mode) {
  const panel = await within(canvasElement).findByTestId(`brand-tokens-${mode}`);
  const values = [...panel.querySelectorAll<HTMLElement>('[data-token]')];
  await expect(values.length).toBeGreaterThan(30);
  for (const value of values) {
    await expect(value.textContent, value.dataset.token).not.toBe('');
  }
  for (const swatch of [...palette, ...meanings]) {
    await expect(within(panel).getByTestId(`brand-swatch-${swatch.token.slice('--brand-'.length)}`)).toBeVisible();
  }
}
