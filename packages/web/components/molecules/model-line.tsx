import { harnessWord } from '../../lib/harness';

/**
 * What a crewed ship's session runs: its harness, read with the location
 * above it, and the ship's current model, the last its sessions stated
 * (#157). Self-reported, never verified. Nothing while neither is known.
 */
export function ModelLine({ harness, model, testId }: { harness: string | null; model: string | null; testId?: string }) {
  if (harness === null && model === null) {
    return null;
  }
  return (
    <span data-testid={testId} className="flex min-w-0 flex-wrap items-center gap-x-1 text-meta text-muted-foreground">
      {harness === null ? null : <span>{harnessWord(harness)}</span>}
      {harness !== null && model !== null ? <span aria-hidden>·</span> : null}
      {model === null ? null : <span className="truncate font-mono text-id">{model}</span>}
    </span>
  );
}
