'use client';

import { useId, useSyncExternalStore } from 'react';

import { classNames } from './class-names.js';
import {
  SIGN_IN_CANVAS,
  SIGN_IN_HORIZON,
  SIGN_IN_SUN_SHARE,
  drawSignInBackground,
  pickSignInBackground,
  type SignInBackgroundName,
  type SignInTone,
} from './sign-in-backgrounds.js';

/**
 * Picked once per page load in the browser, so every screen that shows a
 * background in this load shows the same one. The server picks none: the
 * background appears once the page runs, and server and browser agree.
 */
const PICKED_AT_LOAD = pickSignInBackground(Math.random);

function pickedAtLoad(): SignInBackgroundName {
  return PICKED_AT_LOAD;
}

function pickedOnServer(): undefined {
  return undefined;
}

function staysPut(): () => void {
  return () => undefined;
}

/** The faintness from the mockup, on the brand foreground and primary; the sun and the sky have their own light and dark. */
const TONES = classNames(
  '[--sign-in-faint:color-mix(in_oklch,var(--foreground)_11%,transparent)] [--sign-in-brand:color-mix(in_oklch,var(--primary)_22%,transparent)]',
  '[--sign-in-warm:oklch(0.88_0.06_60)] [--sign-in-sky:oklch(0.9_0.04_255)]',
  'dark:[--sign-in-faint:color-mix(in_oklch,var(--foreground)_9%,transparent)] dark:[--sign-in-brand:color-mix(in_oklch,var(--primary)_20%,transparent)]',
  'dark:[--sign-in-warm:oklch(0.55_0.06_55)] dark:[--sign-in-sky:oklch(0.3_0.05_260)]',
);

const COLOUR: Record<SignInTone, string> = {
  faint: 'var(--sign-in-faint)',
  brand: 'var(--sign-in-brand)',
  warm: 'var(--sign-in-warm)',
};

const { width: WIDTH, height: HEIGHT } = SIGN_IN_CANVAS;
const HORIZON_PERCENT = `${String((SIGN_IN_HORIZON / HEIGHT) * 100)}%`;
const HILLS = `M0 ${String(SIGN_IN_HORIZON)} L0 186 C 180 166 320 182 470 172 S 760 192 920 178 S 1260 160 1420 182 L ${String(WIDTH)} 176 L ${String(WIDTH)} ${String(SIGN_IN_HORIZON)} Z`;
const SUN_TRANSFORM = `translate(${String(SIGN_IN_SUN_SHARE)} 0.2) scale(0.35 1) translate(${String(-SIGN_IN_SUN_SHARE)} -0.2)`;

/**
 * The ground of a signed-out screen (docs/design/sign-in-backgrounds): one of
 * the six backgrounds, picked at random at load, covering its positioned
 * parent behind the card. Without a background named, it shows the one picked.
 */
export function SignInBackground({ background, className }: { background?: SignInBackgroundName; className?: string }) {
  const picked = useSyncExternalStore(staysPut, pickedAtLoad, pickedOnServer);
  const id = useId();
  const shown = background ?? picked;
  if (shown === undefined) {
    return null;
  }
  const skyId = `${id}-sky`;
  const sunId = `${id}-sun`;
  return (
    <svg
      data-testid="sign-in-background"
      data-background={shown}
      aria-hidden="true"
      viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
      preserveAspectRatio="xMidYMid slice"
      className={classNames('pointer-events-none absolute inset-0 size-full', TONES, className)}
    >
      <defs>
        <linearGradient id={skyId} x1={0} y1={0} x2={0} y2={1}>
          <stop offset="0%" stopColor="var(--sign-in-sky)" stopOpacity={0} />
          <stop offset={HORIZON_PERCENT} stopColor="var(--sign-in-warm)" stopOpacity={0.4} />
          <stop offset="50%" stopColor="var(--sign-in-sky)" stopOpacity={0.12} />
          <stop offset="100%" stopColor="var(--sign-in-sky)" stopOpacity={0} />
        </linearGradient>
        <radialGradient id={sunId} cx={SIGN_IN_SUN_SHARE} cy={0.2} r={0.35} gradientTransform={SUN_TRANSFORM}>
          <stop offset="0%" stopColor="var(--sign-in-warm)" stopOpacity={0.4} />
          <stop offset="100%" stopColor="var(--sign-in-warm)" stopOpacity={0} />
        </radialGradient>
      </defs>
      <rect width={WIDTH} height={HEIGHT} fill={`url(#${skyId})`} />
      <rect width={WIDTH} height={HEIGHT} fill={`url(#${sunId})`} />
      <path d={HILLS} fill={COLOUR.brand} opacity={0.45} />
      <line x1={0} y1={SIGN_IN_HORIZON} x2={WIDTH} y2={SIGN_IN_HORIZON} stroke={COLOUR.faint} strokeWidth={1} />
      {drawSignInBackground(shown).map((mark) =>
        mark.kind === 'boat' ? (
          <g key={`boat ${String(mark.x)} ${String(mark.y)}`} transform={`translate(${String(mark.x)} ${String(mark.y)}) scale(${String(mark.scale)})`} fill={COLOUR[mark.tone]}>
            <path d="M0 -26 L0 0 L13 0 Z" />
            <path d="M-2 -20 L-2 0 L-11 0 Z" opacity={0.75} />
            <path d="M-13 3 L15 3 L11 8 L-9 8 Z" />
          </g>
        ) : (
          <line
            key={`line ${String(mark.x1)} ${String(mark.y1)} ${String(mark.x2)} ${String(mark.y2)}`}
            x1={mark.x1}
            y1={mark.y1}
            x2={mark.x2}
            y2={mark.y2}
            stroke={COLOUR[mark.tone]}
            strokeWidth={mark.width}
            opacity={mark.opacity}
            strokeLinecap={mark.isDashed ? undefined : 'round'}
            strokeDasharray={mark.isDashed ? '4 6' : undefined}
          />
        ),
      )}
    </svg>
  );
}
