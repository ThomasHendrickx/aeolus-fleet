import { Package, Sparkles } from 'lucide-react';

import { classNames } from '../../lib/class-names';
import { isSoftwareModel } from '../../lib/model-tag';
import { relativeTime } from '../../lib/relative-time';

/**
 * What a ship's session last stated it runs on, exactly as stated
 * (docs/design/png/ModelTag.png): an AI model id with the sparkles mark on
 * --secondary; software, a package, with the package mark, a dashed outline
 * and muted text. Its title and accessible name carry the full value and when
 * it was stated. "Not stated yet" for a crewed ship that has sent nothing;
 * nothing for argo and ships without a session (awaiting crew, retired).
 */
export function ModelTag({
  model,
  isCrewed,
  now,
  testId,
}: {
  /** The ship's current model and when it was stated; null before any. */
  model: { id: string; statedAt: string } | null;
  /** Whether a session crews the ship: only then does it show anything. */
  isCrewed: boolean;
  now: Date;
  testId?: string;
}) {
  if (!isCrewed) {
    return null;
  }
  if (model === null) {
    return (
      <span data-testid={testId} className="text-meta text-muted-foreground">
        Not stated yet
      </span>
    );
  }
  const isSoftware = isSoftwareModel(model.id);
  const Icon = isSoftware ? Package : Sparkles;
  const relative = relativeTime(new Date(model.statedAt), now);
  const stated = `stated ${relative.charAt(0).toLowerCase()}${relative.slice(1)}`;
  const detail = isSoftware ? `software, ${stated}` : stated;
  return (
    <span
      data-testid={testId}
      data-slot="model-tag"
      data-software={isSoftware ? '' : undefined}
      title={`${model.id} · ${detail}`}
      className={classNames(
        'inline-flex max-w-44 min-w-0 items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-id [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0',
        isSoftware ? 'border border-dashed border-border text-muted-foreground' : 'bg-secondary text-secondary-foreground',
      )}
    >
      <Icon aria-hidden />
      <span className="truncate">{model.id}</span>
      <span className="sr-only">, {detail}</span>
    </span>
  );
}
