import type { LocationKind } from '@aeolus-fleet/common';
import { AppWindow, Bot, Cloud, Laptop, MapPin, MessageCircle, Server, SquareTerminal, Unplug, type LucideIcon } from 'lucide-react';

import { classNames } from '../../lib/class-names';
import { harnessKind, harnessWord, type HarnessKind } from '../../lib/harness';
import { locationKindWord } from '../../lib/location';

const KIND_ICONS: Record<LocationKind, LucideIcon> = {
  DEVICE: Laptop,
  CLOUD: Cloud,
  SERVER: Server,
  OTHER: MapPin,
};

const HARNESS_ICONS: Record<HarnessKind, LucideIcon> = {
  coding: SquareTerminal,
  chat: MessageCircle,
  bot: Bot,
  console: AppWindow,
};

const SIZES = {
  md: 'text-body',
  sm: 'text-meta',
} as const;

interface LocationTagProps {
  /** Where the crewing session runs; null while no session crews the ship. */
  kind: LocationKind | null;
  /** The short description the session reported, when there is one. */
  description?: string | null;
  /** The harness the session runs in (FleetTable, Runs on): shown first, the description moves to the title. */
  harness?: string | null;
  /** Tables under 1280 px: the description alone, the full text in title. */
  isCompact?: boolean;
  size?: keyof typeof SIZES;
  className?: string;
}

/**
 * Where the session that crews a ship runs (docs/design/png/LocationTag.png):
 * `<Kind> · <description>` with the kind's icon. With a harness, as FleetTable
 * shows it: the harness, with a generic icon for its kind when it is a known
 * one, then the location kind with its icon ("Claude Code · Device"); the
 * description moves to the title. Shown on crewed ships; an
 * awaiting ship shows its prompt status instead, so "No session" is the rare
 * case of a crewed status without a location.
 */
export function LocationTag({ kind, description = null, harness = null, isCompact = false, size = 'md', className }: LocationTagProps) {
  const frame = classNames(
    'inline-flex min-w-0 items-center gap-1.5 text-muted-foreground [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0',
    SIZES[size],
    className,
  );
  if (kind === null) {
    return (
      <span data-slot="location-tag" className={frame}>
        <Unplug aria-hidden />
        No session
      </span>
    );
  }
  const Icon = KIND_ICONS[kind];
  const word = locationKindWord(kind);
  const fullText = description === null ? word : `${word} · ${description}`;
  if (harness !== null) {
    const harnessIcon = harnessKind(harness);
    const HarnessIcon = harnessIcon === undefined ? undefined : HARNESS_ICONS[harnessIcon];
    const named = harnessWord(harness);
    return (
      <span data-slot="location-tag" className={frame} title={description === null ? `${named} · ${word}` : `${named} · ${word}: ${description}`}>
        {HarnessIcon === undefined ? null : <HarnessIcon aria-hidden />}
        <span className="truncate text-foreground">{named}</span>
        <span aria-hidden>·</span>
        <Icon aria-hidden />
        <span className="truncate">{word}</span>
        {description === null ? null : <span className="sr-only">: {description}</span>}
      </span>
    );
  }
  if (isCompact) {
    return (
      <span data-slot="location-tag" className={frame} title={fullText}>
        <Icon aria-hidden />
        <span className="sr-only">{word}: </span>
        <span className="truncate text-foreground">{description ?? word}</span>
      </span>
    );
  }
  return (
    <span data-slot="location-tag" className={frame}>
      <Icon aria-hidden />
      <span className="truncate">
        {word}
        {description === null ? null : (
          <>
            <span aria-hidden> · </span>
            <span className="sr-only">, </span>
            <span className="text-foreground">{description}</span>
          </>
        )}
      </span>
    </span>
  );
}
