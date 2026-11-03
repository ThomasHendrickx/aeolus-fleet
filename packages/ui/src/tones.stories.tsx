import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Activity,
  Archive,
  CircleDashed,
  CirclePause,
  OctagonPause,
  TriangleAlert,
  UserCheck,
} from "lucide-react";
import type { ComponentType } from "react";
import { expect, within } from "storybook/test";

type Mode = "light" | "dark";

/** A tone family, the one thing it means and the ship state or status that shows it. Idle has no tone. */
interface Tone {
  readonly family:
    "attention" | "waiting" | "blocked" | "active" | "ok" | "ended" | null;
  readonly colour: string;
  readonly means: string;
  readonly word: string;
  readonly icon: ComponentType<{ className?: string }>;
}

const tones: readonly Tone[] = [
  {
    family: "attention",
    colour: "Coral",
    means: "Something is wrong: act now",
    word: "Alert",
    icon: TriangleAlert,
  },
  {
    family: "waiting",
    colour: "Amber",
    means: "Waits on a person",
    word: "Awaiting crew",
    icon: CircleDashed,
  },
  {
    family: "blocked",
    colour: "Violet",
    means: "The crew says it cannot go on",
    word: "Blocked",
    icon: OctagonPause,
  },
  {
    family: "active",
    colour: "Sea",
    means: "Live and in motion",
    word: "Working",
    icon: Activity,
  },
  {
    family: "ok",
    colour: "Green",
    means: "Settled and well",
    word: "Crewed",
    icon: UserCheck,
  },
  {
    family: "ended",
    colour: "Grey",
    means: "Over for good",
    word: "Retired",
    icon: Archive,
  },
  {
    family: null,
    colour: "None",
    means: "Nothing going on",
    word: "Idle",
    icon: CirclePause,
  },
];

/** The tone's chip: icon and word in its foreground on its background and border. Idle is plain muted text. */
function Chip({ tone }: { tone: Tone }) {
  const Icon = tone.icon;
  const style = tone.family
    ? {
        color: `var(--tone-${tone.family}-fg)`,
        background: `var(--tone-${tone.family}-bg)`,
        borderColor: `var(--tone-${tone.family}-border)`,
      }
    : { color: "var(--muted-foreground)" };
  return (
    <span
      data-testid={`tone-chip-${tone.word.toLowerCase().replaceAll(" ", "-")}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-transparent px-2.5 py-0.5 text-caption font-medium whitespace-nowrap"
      style={style}
    >
      <Icon className="size-(--size-icon-sm)" />
      {tone.word}
    </span>
  );
}

/** Every tone in one mode: the chip, then the token, the colour and the one meaning. */
function Tones({ mode }: { mode: Mode }) {
  return (
    <div
      data-testid={`tones-${mode}`}
      className={`${mode === "dark" ? "dark " : ""}min-w-0 bg-background px-6 py-6 text-foreground`}
    >
      <h2 className="mb-1 text-section font-semibold">
        {mode === "light" ? "Light" : "Dark"}
      </h2>
      <p className="mb-4 text-meta text-muted-foreground">
        One meaning per tone. The colours live in this package; an app takes
        them from here.
      </p>
      <div className="grid gap-3 rounded-lg border border-border bg-card p-4">
        {tones.map((tone) => (
          <div
            key={tone.word}
            className="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[150px_110px_70px_minmax(0,1fr)]"
          >
            <Chip tone={tone} />
            <code className="hidden font-mono text-id text-muted-foreground sm:block">
              {tone.family ? `--tone-${tone.family}-*` : "--muted-foreground"}
            </code>
            <span className="hidden text-meta font-medium sm:block">
              {tone.colour}
            </span>
            <span className="text-meta text-muted-foreground">
              {tone.means}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const meta = {
  title: "Design/Tones",
  component: Tones,
  decorators: [
    (Story) => (
      <div className="-m-6">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Tones>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Light, on the page ground. */
export const Light: Story = {
  args: { mode: "light" },
  play: async ({ canvasElement }) => {
    await expectEveryToneShown(canvasElement, "light");
  },
};

/** Dark, on its own ground. */
export const Dark: Story = {
  args: { mode: "dark" },
  play: async ({ canvasElement }) => {
    await expectEveryToneShown(canvasElement, "dark");
  },
};

/** Both modes side by side, each tone beside its other self. */
export const LightAndDark: Story = {
  args: { mode: "light" },
  render: () => (
    <div className="grid lg:grid-cols-2">
      <Tones mode="light" />
      <Tones mode="dark" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expectEveryToneShown(canvasElement, "light");
    await expectEveryToneShown(canvasElement, "dark");
    const canvas = within(canvasElement);
    const colour = (mode: Mode) =>
      getComputedStyle(
        within(canvas.getByTestId(`tones-${mode}`)).getByTestId(
          "tone-chip-blocked",
        ),
      ).color;
    await expect(colour("dark")).not.toBe(colour("light"));
  },
};

/** Every state has its chip with its word, and each toned chip paints a foreground that is not the page's text. */
async function expectEveryToneShown(canvasElement: HTMLElement, mode: Mode) {
  const panel = await within(canvasElement).findByTestId(`tones-${mode}`);
  const text = getComputedStyle(panel).color;
  for (const tone of tones) {
    const chip = within(panel).getByTestId(
      `tone-chip-${tone.word.toLowerCase().replaceAll(" ", "-")}`,
    );
    await expect(chip).toHaveTextContent(tone.word);
    if (tone.family) await expect(getComputedStyle(chip).color).not.toBe(text);
  }
}
