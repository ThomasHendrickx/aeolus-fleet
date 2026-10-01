import type { Party } from '@aeolus-fleet/common';

/**
 * A sentence the console shows in a history row, in parts, so each ship in it
 * renders as a ShipName with its id suffix and the rest as plain text.
 */
export type SentencePart = { kind: 'text'; text: string } | { kind: 'ship'; party: Party };

/** The operator ship's name: it never carries an id suffix (docs/design/conventions.md, "Copy"). */
export const OPERATOR_NAME = 'argo';

export function text(value: string): SentencePart {
  return { kind: 'text', text: value };
}

export function ship(party: Party): SentencePart {
  return { kind: 'ship', party };
}

/** The sentence as plain text, for tests and accessible names: a ship reads as its name. */
export function plainText(parts: readonly SentencePart[]): string {
  return parts.map((part) => (part.kind === 'text' ? part.text : part.party.name)).join('');
}

/** "1 in-flight delivery", "3 in-flight deliveries": numbers as digits (docs/design/conventions.md, "Copy"). */
export function counted(count: number, words: { one: string; many: string }): string {
  return `${String(count)} ${count === 1 ? words.one : words.many}`;
}

/** The text with its first letter in capitals, for a sentence that starts with it. */
export function capitalised(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
