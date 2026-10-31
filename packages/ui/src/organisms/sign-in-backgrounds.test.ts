import { describe, expect, it } from 'vitest';

import { SIGN_IN_BACKGROUNDS, drawSignInBackground, pickSignInBackground, type SignInMark } from './sign-in-backgrounds.js';

// Worked examples: what docs/design/sign-in-backgrounds/mockup.html draws for each tab.
const MOCKUP = [
  { background: 'from-above-1', boats: 14, lastBoat: { x: 640, y: 968, scale: 1.452 } },
  { background: 'squadrons-1', boats: 21, lastBoat: { x: 943.9230762309968, y: 292.9520952724629, scale: 0.43942814290869425 } },
  { background: 'squadrons-3', boats: 22, lastBoat: { x: 528, y: 449.6, scale: 0.6744 } },
  { background: 'squadrons-4', boats: 21, lastBoat: { x: 528, y: 465.6, scale: 0.6984 } },
  { background: 'squadrons-5', boats: 23, lastBoat: { x: 206.33490921926446, y: 506.5240602225643, scale: 0.7597860903338465 } },
  { background: 'squadrons-6', boats: 21, lastBoat: { x: 1504, y: 709.5495911341029, scale: 1.0643243867011543 } },
] as const;

const PRECISION = 9;

function boatsOf(marks: readonly SignInMark[]) {
  return marks.flatMap((mark) => (mark.kind === 'boat' ? [mark] : []));
}

describe('at load, one of the six backgrounds is picked at random', () => {
  it('spreads the random number evenly over the six, in the mockup order', () => {
    const randoms = [0, 0.17, 0.34, 0.5, 0.67, 0.99];

    const picked = randoms.map((random) => pickSignInBackground(() => random));

    expect(picked).toEqual(['from-above-1', 'squadrons-1', 'squadrons-3', 'squadrons-4', 'squadrons-5', 'squadrons-6']);
  });
});

describe('each background draws as the mockup does', () => {
  it.each(MOCKUP)('$background draws its $boats boats where the mockup does', ({ background, boats, lastBoat }) => {
    const drawn = boatsOf(drawSignInBackground(background));

    expect(drawn).toHaveLength(boats);
    const last = drawn.at(-1);
    expect(last?.x).toBeCloseTo(lastBoat.x, PRECISION);
    expect(last?.y).toBeCloseTo(lastBoat.y, PRECISION);
    expect(last?.scale).toBeCloseTo(lastBoat.scale, PRECISION);
  });

  it('draws the same water on every background, from the mockup first water line', () => {
    const firstWaterLines = SIGN_IN_BACKGROUNDS.map((background) => drawSignInBackground(background).find((mark) => mark.kind === 'line'));

    for (const line of firstWaterLines) {
      expect(line).toMatchObject({ tone: 'faint', opacity: 0.6 });
      expect(line?.kind === 'line' && line.x1).toBeCloseTo(624.1514654704704, PRECISION);
      expect(line?.kind === 'line' && line.y1).toBeCloseTo(204.00205703032066, PRECISION);
    }
  });
});

describe('the card stays centred and readable', () => {
  it.each(SIGN_IN_BACKGROUNDS)('%s keeps its boats out of the middle, where the card sits', (background) => {
    const boats = boatsOf(drawSignInBackground(background));

    const inTheMiddle = boats.filter((boat) => Math.abs(boat.x - 800) < 250 && Math.abs(boat.y - 500) < 200);
    expect(inTheMiddle).toEqual([]);
  });
});
