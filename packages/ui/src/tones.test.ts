import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// The tone tokens' rules that a story cannot show: each family's approved
// values in both modes, and that the Tailwind theme maps every family.

const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const theme = readFileSync(new URL("./theme.css", import.meta.url), "utf8");

/** The custom properties a block of tokens.css declares, by name. */
function declarations(selector: string): Map<string, string> {
  const start = tokens.indexOf(`${selector} {`);
  const block = tokens.slice(start, tokens.indexOf("\n}", start));
  return new Map(
    [...block.matchAll(/(--tone-[a-z-]+):\s*([^;]+);/g)].flatMap(
      ([, name, value]) => (name && value ? [[name, value] as const] : []),
    ),
  );
}

const light = declarations(":root");
const dark = declarations(".dark");

const families = [
  "attention",
  "waiting",
  "blocked",
  "active",
  "ok",
  "ended",
] as const;
const parts = ["fg", "bg", "border"] as const;

// Coral for attention, Amber for waiting, violet for blocked, Sea for active.
const approved: Record<
  string,
  Record<"light" | "dark", readonly [string, string, string]>
> = {
  attention: {
    light: ["#AE3820", "#FFEEE9", "#FFC2B2"],
    dark: ["#FFA58F", "#3A1E19", "#7B3628"],
  },
  waiting: {
    light: ["#8A5300", "#FDF4E1", "#F0D198"],
    dark: ["#F3C46C", "#33280F", "#6E5119"],
  },
  blocked: {
    light: ["#6B3FB8", "#F3EEFC", "#D3C3F2"],
    dark: ["#C9B1F7", "#2A2142", "#523E86"],
  },
  active: {
    light: ["#0B6A88", "#E8F6FB", "#A6DAEB"],
    dark: ["#85D3EC", "#0E2C37", "#1F5E72"],
  },
};

describe("the tone tokens", () => {
  it("give each family a foreground, a background and a border in both modes, and nothing else", () => {
    const names = families.flatMap((family) =>
      parts.map((part) => `--tone-${family}-${part}`),
    );
    expect([...light.keys()].sort()).toEqual([...names].sort());
    expect([...dark.keys()].sort()).toEqual([...names].sort());
  });

  it.each(Object.keys(approved))(
    "give %s its approved colours in light and dark",
    (family) => {
      for (const mode of ["light", "dark"] as const) {
        const values = mode === "light" ? light : dark;
        const expected = approved[family]?.[mode];
        expect(
          parts.map((part) =>
            values.get(`--tone-${family}-${part}`)?.toUpperCase(),
          ),
          `${family} ${mode}`,
        ).toEqual(expected);
      }
    },
  );

  it("keep the colours of ok and ended, and give idle no tone", () => {
    expect(light.get("--tone-ok-fg")).toBe("oklch(0.44 0.1 155)");
    expect(light.get("--tone-ended-fg")).toBe("oklch(0.47 0.015 257)");
    expect([...light.keys()].some((name) => name.includes("idle"))).toBe(false);
  });

  it("map every family onto Tailwind", () => {
    for (const family of families) {
      for (const part of parts) {
        expect(theme).toContain(
          `--color-tone-${family}-${part}: var(--tone-${family}-${part});`,
        );
      }
    }
  });
});
