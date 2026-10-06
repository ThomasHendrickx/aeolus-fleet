/** A new idempotency key on every call, for tests whose requests must never repeat one by chance. */
let next = 0;

export function newKey(): string {
  next += 1;
  return `key-${String(next)}`;
}
