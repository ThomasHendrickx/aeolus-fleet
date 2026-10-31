/**
 * The six backgrounds of the signed-out screens, ported from
 * docs/design/sign-in-backgrounds/mockup.html: the sea seen from above with
 * single ships, and in five of them squadrons sailing among them. Each draws
 * the same every time from its seeds, on a 1600 by 1000 canvas; one is picked
 * at random when a screen loads.
 */

export const SIGN_IN_BACKGROUNDS = ['from-above-1', 'squadrons-1', 'squadrons-3', 'squadrons-4', 'squadrons-5', 'squadrons-6'] as const;

export type SignInBackgroundName = (typeof SIGN_IN_BACKGROUNDS)[number];

/** The canvas every background is drawn on; it covers the screen, cut at the sides or the top and bottom. */
export const SIGN_IN_CANVAS = { width: 1600, height: 1000 } as const;

/** Where the sea meets the hills, as a share of the height. */
const HORIZON_SHARE = 0.2;
export const SIGN_IN_HORIZON = SIGN_IN_CANVAS.height * HORIZON_SHARE;

/** Where the sun's glow on the water sits, as a share of the width. */
export const SIGN_IN_SUN_SHARE = 0.68;

/** faint: the foreground, barely there. brand: the primary, a little stronger. warm: the sun's glow. */
export type SignInTone = 'faint' | 'brand' | 'warm';

export type SignInMark =
  | {
      readonly kind: 'line';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly tone: SignInTone;
      readonly width: number;
      readonly opacity: number;
      readonly isDashed: boolean;
    }
  | { readonly kind: 'boat'; readonly x: number; readonly y: number; readonly scale: number; readonly tone: SignInTone };

/** A ship on the sea: where across (a share of the width), how far toward the viewer (a share of the sea), and its heading in degrees. */
type Ship = readonly [across: number, toward: number, heading: number];

type SquadronShape = 'loose' | 'tight' | 'curve' | 'line';

/** A squadron: where its lead sails, its heading, its shape and how many ships it holds. */
type Squadron = readonly [across: number, toward: number, heading: number, shape: SquadronShape, size: number];

const WATER_SEED = 41;
const WATER_LINES = 190;

const SHIPS_FROM_ABOVE: readonly Ship[] = [
  [0.14, 0.25, 20], [0.42, 0.12, -10], [0.83, 0.2, 200], [0.9, 0.55, -30], [0.22, 0.7, 15], [0.62, 0.82, 195], [0.08, 0.95, -20], [0.95, 0.9, 170],
  [0.5, 0.4, 10], [0.33, 0.5, 190], [0.7, 0.06, 0], [0.27, 0.06, 180], [0.58, 0.3, 200], [0.04, 0.45, 10], [0.76, 0.68, -15], [0.4, 0.96, 185],
];

const SINGLE_SHIPS: readonly Ship[] = [
  [0.14, 0.25, 20], [0.42, 0.12, -10], [0.83, 0.2, 200], [0.9, 0.55, -30], [0.08, 0.95, -20], [0.95, 0.9, 170],
  [0.33, 0.5, 190], [0.04, 0.45, 10], [0.7, 0.06, 0], [0.27, 0.07, 180], [0.58, 0.32, 200], [0.52, 0.05, 10],
];

const SQUADRONS: Record<Exclude<SignInBackgroundName, 'from-above-1'>, { readonly seed: number; readonly squadrons: readonly Squadron[] }> = {
  'squadrons-1': { seed: 61, squadrons: [[0.2, 0.72, 15, 'loose', 4], [0.74, 0.6, 195, 'loose', 5], [0.6, 0.15, 5, 'loose', 3]] },
  'squadrons-3': { seed: 89, squadrons: [[0.18, 0.78, 15, 'line', 4], [0.8, 0.6, 195, 'line', 5], [0.55, 0.18, 5, 'line', 4], [0.3, 0.3, 190, 'line', 3]] },
  'squadrons-4': { seed: 97, squadrons: [[0.2, 0.72, 15, 'loose', 4], [0.8, 0.6, 195, 'line', 4], [0.58, 0.16, 5, 'loose', 3], [0.3, 0.32, 190, 'line', 3]] },
  'squadrons-5': { seed: 53, squadrons: [[0.2, 0.74, 15, 'tight', 5], [0.76, 0.6, 195, 'tight', 4], [0.6, 0.15, 5, 'tight', 3], [0.12, 0.4, 10, 'tight', 3]] },
  'squadrons-6': { seed: 83, squadrons: [[0.18, 0.78, 15, 'curve', 5], [0.82, 0.6, 195, 'curve', 5], [0.55, 0.17, 5, 'curve', 4]] },
};

/** The card's place in the middle of the canvas, where no ship sails. */
const CARD_HALF_WIDTH = 250;
const CARD_HALF_HEIGHT = 200;

/** Which background a screen shows, from a random number in [0, 1). */
export function pickSignInBackground(random: () => number): SignInBackgroundName {
  const index = Math.min(SIGN_IN_BACKGROUNDS.length - 1, Math.floor(random() * SIGN_IN_BACKGROUNDS.length));
  return SIGN_IN_BACKGROUNDS[index] ?? 'from-above-1';
}

/** The marks of one background, back to front: the water, then each ship's wake and the ship. */
export function drawSignInBackground(background: SignInBackgroundName): readonly SignInMark[] {
  const random = seededRandom(WATER_SEED);
  const water = Array.from({ length: WATER_LINES }, () => waterLine(random));
  const ships = background === 'from-above-1' ? SHIPS_FROM_ABOVE : shipsInSquadrons(SQUADRONS[background]);
  return [...water, ...ships.flatMap(shipMarks)];
}

/** The mockup's generator (Park and Miller), so each seed draws what the mockup drew. */
function seededRandom(seed: number): () => number {
  const modulus = 2147483647;
  const multiplier = 16807;
  let state = seed;
  return () => {
    state = (state * multiplier) % modulus;
    return state / modulus;
  };
}

/** A short line on the water, longer and thicker toward the viewer, warm where the sun glows on it. */
function waterLine(random: () => number): SignInMark {
  const { width, height } = SIGN_IN_CANVAS;
  const toward = Math.pow(random(), 1.6);
  const y = SIGN_IN_HORIZON + 4 + (height - SIGN_IN_HORIZON) * toward;
  const x = random() * width;
  const length = (6 + random() * 18) * (0.4 + toward * 3);
  const isNearSun = Math.abs(x - width * SIGN_IN_SUN_SHARE) < 40 + toward * 260;
  return {
    kind: 'line',
    x1: x - length / 2,
    y1: y,
    x2: x + length / 2,
    y2: y,
    tone: isNearSun ? 'warm' : 'faint',
    width: 0.6 + toward * 1.2,
    opacity: isNearSun ? 0.8 : 0.6,
    isDashed: false,
  };
}

/** The single ships, then each squadron's ships around its lead. */
function shipsInSquadrons({ seed, squadrons }: { readonly seed: number; readonly squadrons: readonly Squadron[] }): readonly Ship[] {
  const random = seededRandom(seed);
  const inSquadrons = squadrons.flatMap(([across, toward, heading, shape, size]) => {
    const direction = Math.cos(radians(heading)) >= 0 ? 1 : -1;
    return Array.from({ length: size }, (_, place): Ship => {
      const [offsetAcross, offsetToward] = squadronOffset({ shape, place, size, direction, random });
      return [across + offsetAcross, Math.min(0.99, Math.max(0.02, toward + offsetToward)), heading];
    });
  });
  return [...SINGLE_SHIPS, ...inSquadrons];
}

/** Where a ship sails from its squadron's lead: scattered, close abreast, astern on a bending course, or astern in line. */
function squadronOffset({ shape, place, size, direction, random }: { readonly shape: SquadronShape; readonly place: number; readonly size: number; readonly direction: number; readonly random: () => number }): readonly [number, number] {
  switch (shape) {
    case 'loose': {
      const across = (random() - 0.5) * 0.09;
      return [across, (random() - 0.5) * 0.08];
    }
    case 'tight': {
      const across = (place - (size - 1) / 2) * 0.018 + (random() - 0.5) * 0.02;
      return [across, (random() - 0.5) * 0.05];
    }
    case 'curve':
      return [-direction * place * 0.03, place * 0.012 + Math.sin(place * 0.9) * 0.025];
    case 'line':
      return [-direction * place * 0.03, place * 0.012];
  }
}

/** A ship and its wake, bigger toward the viewer; none sails where the card sits. */
function shipMarks([across, toward, heading]: Ship): readonly SignInMark[] {
  const { width, height } = SIGN_IN_CANVAS;
  const x = across * width;
  const y = SIGN_IN_HORIZON + (height - SIGN_IN_HORIZON) * toward;
  if (Math.abs(x - width / 2) < CARD_HALF_WIDTH && Math.abs(y - height / 2) < CARD_HALF_HEIGHT) {
    return [];
  }
  const scale = 0.3 + toward * 1.2;
  const tone: SignInTone = toward > 0.6 ? 'brand' : 'faint';
  const isHeadingLeft = heading > 90 && heading < 270;
  return [...wake({ x, y: y + 6 * scale, scale: scale * 0.8, heading: isHeadingLeft ? 180 : 0, length: 40 + toward * 120, tone }), { kind: 'boat', x, y, scale, tone }];
}

/** The V a ship leaves behind it, and the dashed line along its middle. */
function wake({ x, y, scale, heading, length, tone }: { readonly x: number; readonly y: number; readonly scale: number; readonly heading: number; readonly length: number; readonly tone: SignInTone }): readonly SignInMark[] {
  const back = radians(heading + 180);
  const sternX = x + Math.cos(back) * 14 * scale;
  const sternY = y + Math.sin(back) * 14 * scale;
  const arms = [-14, 14].map((spread): SignInMark => {
    const angle = back + radians(spread);
    return { kind: 'line', x1: sternX, y1: sternY, x2: x + Math.cos(angle) * length, y2: y + Math.sin(angle) * length, tone, width: Math.max(0.6, scale * 0.9), opacity: 0.7, isDashed: false };
  });
  const middle: SignInMark = { kind: 'line', x1: sternX, y1: sternY, x2: x + Math.cos(back) * length * 1.1, y2: y + Math.sin(back) * length * 1.1, tone, width: Math.max(0.5, scale * 0.6), opacity: 0.4, isDashed: true };
  return [...arms, middle];
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
