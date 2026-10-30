import { HarnessUnknown } from '../../../../components/molecules/harness-unknown';
import { harnessWord } from '../../../../lib/harness';

/**
 * What a crewed ship's session runs: its harness, read with the location
 * above it, and the ship's current model, the last its sessions stated
 * (#157). Self-reported, never verified. An agent ship crewed by a session
 * that stated no harness shows Harness unknown, a fault (aeolus-fleet#1408).
 * Nothing while neither is known otherwise.
 */
export function ModelLine({ harness, model, isHarnessUnknown = false, testId }: { harness: string | null; model: string | null; isHarnessUnknown?: boolean; testId?: string }) {
  if (harness === null && model === null && !isHarnessUnknown) {
    return null;
  }
  const hasHarness = harness !== null || isHarnessUnknown;
  return (
    <span data-testid={testId} className="flex min-w-0 flex-wrap items-center gap-x-1 text-meta text-muted-foreground">
      {harness === null ? null : <span>{harnessWord(harness)}</span>}
      {harness === null && isHarnessUnknown ? <HarnessUnknown /> : null}
      {hasHarness && model !== null ? <span aria-hidden>·</span> : null}
      {model === null ? null : <span className="truncate font-mono text-id">{model}</span>}
    </span>
  );
}
