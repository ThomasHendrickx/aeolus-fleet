import { relativeTime } from './relative-time';

const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;

/**
 * Whether a stated model is software rather than an AI model
 * (docs/design/png/ModelTag.png): a package such as
 * @aeolus-fleet/squadrons@0.12.0 starts with @ or ends in @x.y.z. A model id
 * with a date, such as claude-opus-4@20250514, stays a model.
 */
export function isSoftwareModel(value: string): boolean {
  return value.startsWith('@') || /@\d+\.\d+\.\d+$/.test(value);
}

/**
 * What the ModelTag's tooltip says under the value (canvas, OverviewModelHover):
 * what it is and when it was stated, to the second under a minute, as Last
 * seen is: "Model, stated 25 s ago", "Software, stated 3 h ago".
 */
export function modelStatedWords(model: { id: string; statedAt: string }, now: Date): string {
  const at = new Date(model.statedAt);
  const elapsedMs = Math.max(0, now.getTime() - at.getTime());
  const kind = isSoftwareModel(model.id) ? 'Software' : 'Model';
  if (elapsedMs < MINUTE_MS) {
    return `${kind}, stated ${String(Math.floor(elapsedMs / SECOND_MS))} s ago`;
  }
  const relative = relativeTime(at, now);
  return `${kind}, stated ${relative.charAt(0).toLowerCase()}${relative.slice(1)}`;
}
