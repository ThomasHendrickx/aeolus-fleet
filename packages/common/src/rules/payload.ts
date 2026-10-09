/**
 * A payload is at most 64 KB (ADR 0006): a message carries a reference and an
 * instruction, not the content itself.
 */
export const PAYLOAD_MAX_BYTES = 64 * 1024;

const utf8 = new TextEncoder();

/**
 * The size of a payload serialized: the bytes of its text in UTF-8, as the
 * database stores it and counts it.
 */
export function payloadBytes(payload: string): number {
  return utf8.encode(payload).byteLength;
}
