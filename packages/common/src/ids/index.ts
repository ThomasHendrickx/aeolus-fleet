/**
 * Prefixed, time-ordered ids (ADR 0005).
 *
 * An id is `<prefix>_<body>`. The body is a lowercase ULID: 26 Crockford base32
 * characters holding a 48-bit Unix millisecond timestamp followed by 80 random
 * bits. Because the alphabet is in ASCII order and the body has a fixed length,
 * ids of one kind sort as plain text in creation order. Within one millisecond a
 * generator increments the random part instead of drawing a new one, so the ids it
 * hands out stay strictly ordered.
 */

export const ID_PREFIXES = {
  fleet: 'flt',
  ship: 'shp',
  message: 'msg',
  delivery: 'dlv',
  event: 'evt',
  lease: 'lse',
  credential: 'crd',
  operator: 'opr',
  operatorSession: 'ses',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;
export type IdPrefix = (typeof ID_PREFIXES)[IdKind];
export type Id<K extends IdKind> = `${(typeof ID_PREFIXES)[K]}_${string}`;

export type FleetId = Id<'fleet'>;
export type ShipId = Id<'ship'>;
export type MessageId = Id<'message'>;
export type DeliveryId = Id<'delivery'>;
export type EventId = Id<'event'>;
export type LeaseId = Id<'lease'>;
export type CredentialId = Id<'credential'>;
export type OperatorId = Id<'operator'>;
export type OperatorSessionId = Id<'operatorSession'>;

/** Crockford base32, lowercase. Leaves out i, l, o and u. */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const TIME_LENGTH = 10;
const RANDOM_BYTES = 10;
const MAX_TIME = 2 ** 48 - 1;
const BODY_PATTERN = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/;

const KIND_BY_PREFIX = new Map<string, IdKind>(
  Object.entries(ID_PREFIXES).map(([kind, prefix]) => [prefix, kind as IdKind]),
);

export interface IdGeneratorOptions {
  /** Milliseconds since the Unix epoch. Defaults to `Date.now`. */
  now?: () => number;
  /** Fills the given array with random bytes. Defaults to Web Crypto. */
  fillRandom?: (bytes: Uint8Array<ArrayBuffer>) => void;
}

export type IdGenerator = <K extends IdKind>(kind: K) => Id<K>;

/**
 * Creates an id generator. Each generator keeps its own monotonic state, so ids
 * from one generator never go backwards, even within a millisecond or when the
 * clock steps back.
 */
export function createIdGenerator(options: IdGeneratorOptions = {}): IdGenerator {
  const now = options.now ?? Date.now;
  const fillRandom =
    options.fillRandom ??
    ((bytes: Uint8Array<ArrayBuffer>) => {
      globalThis.crypto.getRandomValues(bytes);
    });

  let lastTime = -1;
  const random = new Uint8Array(RANDOM_BYTES);

  return <K extends IdKind>(kind: K): Id<K> => {
    const time = now();
    if (!Number.isInteger(time) || time < 0 || time > MAX_TIME) {
      throw new RangeError(`Id time must be an integer between 0 and ${String(MAX_TIME)}, got ${String(time)}`);
    }

    if (time > lastTime) {
      lastTime = time;
      fillRandom(random);
    } else {
      increment(random);
    }

    const body = encodeTime(lastTime) + encodeRandom(random);
    return `${ID_PREFIXES[kind]}_${body}`;
  };
}

export interface ParsedId {
  kind: IdKind;
  /** The millisecond the id was created, taken from its body. */
  timestamp: Date;
}

/** Parses an id of any known kind. Returns undefined when the value is not a well-formed id. */
export function parseId(value: string): ParsedId | undefined {
  const separator = value.indexOf('_');
  if (separator === -1) {
    return undefined;
  }

  const kind = KIND_BY_PREFIX.get(value.slice(0, separator));
  const body = value.slice(separator + 1);
  if (kind === undefined || !BODY_PATTERN.test(body)) {
    return undefined;
  }

  return { kind, timestamp: new Date(decodeTime(body.slice(0, TIME_LENGTH))) };
}

/** True when the value is a well-formed id of the given kind. */
export function isId<K extends IdKind>(value: unknown, kind: K): value is Id<K> {
  return typeof value === 'string' && parseId(value)?.kind === kind;
}

function encodeTime(time: number): string {
  let remaining = time;
  let encoded = '';
  for (let index = 0; index < TIME_LENGTH; index += 1) {
    const digit = remaining % 32;
    encoded = charAt(digit) + encoded;
    remaining = (remaining - digit) / 32;
  }
  return encoded;
}

function decodeTime(encoded: string): number {
  let time = 0;
  for (const char of encoded) {
    time = time * 32 + ALPHABET.indexOf(char);
  }
  return time;
}

/** Encodes 80 bits as 16 base32 characters, most significant bits first. */
function encodeRandom(bytes: Uint8Array): string {
  let encoded = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += charAt((buffer >> bits) & 31);
    }
    buffer &= (1 << bits) - 1;
  }
  return encoded;
}

/**
 * Adds one to the random part, big-endian. Running out of room within one
 * millisecond is an error, and leaves the bytes as they were so a later call
 * can never hand out a smaller id.
 */
function increment(bytes: Uint8Array): void {
  if (bytes.every((byte) => byte === 255)) {
    throw new RangeError('Id random part overflowed within one millisecond');
  }
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    const byte = bytes[index] ?? 0;
    if (byte < 255) {
      bytes[index] = byte + 1;
      return;
    }
    bytes[index] = 0;
  }
}

function charAt(digit: number): string {
  const char = ALPHABET[digit];
  if (char === undefined) {
    throw new RangeError(`Not a base32 digit: ${String(digit)}`);
  }
  return char;
}
