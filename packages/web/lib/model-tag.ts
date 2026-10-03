/**
 * Whether a stated model is software rather than an AI model
 * (docs/design/png/ModelTag.png): a package such as
 * @aeolus-fleet/squadrons@0.12.0 starts with @ or ends in @x.y.z. A model id
 * with a date, such as claude-opus-4@20250514, stays a model.
 */
export function isSoftwareModel(value: string): boolean {
  return value.startsWith('@') || /@\d+\.\d+\.\d+$/.test(value);
}
