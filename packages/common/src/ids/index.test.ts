import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createIdGenerator, ID_KINDS, ID_PREFIXES, idSchema, isId, parseId } from './index.js';

const zeroRandom = (bytes: Uint8Array): void => {
  bytes.fill(0);
};

const maxRandom = (bytes: Uint8Array): void => {
  bytes.fill(255);
};

function clockAt(...times: number[]): () => number {
  let index = 0;
  return () => {
    const time = times[Math.min(index, times.length - 1)];
    index += 1;
    if (time === undefined) {
      throw new Error('clockAt needs at least one time');
    }
    return time;
  };
}

describe('createIdGenerator', () => {
  it.each(ID_KINDS.map((kind) => [kind, ID_PREFIXES[kind]] as const))(
    'prefixes %s ids with %s_ and a 26 character lowercase body',
    (kind, prefix) => {
      const id = createIdGenerator()(kind);

      expect(id).toMatch(new RegExp(`^${prefix}_[0-9a-hjkmnp-tv-z]{26}$`));
    },
  );

  it('encodes the ULID reference timestamp as its first ten characters', () => {
    const id = createIdGenerator({ now: () => 1469918176385, fillRandom: zeroRandom })('ship');

    expect(id).toBe('shp_01aryz6s410000000000000000');
  });

  it('encodes the random part most significant bits first', () => {
    const id = createIdGenerator({ now: () => 0, fillRandom: maxRandom })('fleet');

    expect(id).toBe('flt_0000000000zzzzzzzzzzzzzzzz');
  });

  it('sorts as text in creation order across milliseconds', () => {
    const next = createIdGenerator({ now: clockAt(1_000, 1_001, 5_000, 1_700_000_000_000) });

    const ids = [next('message'), next('message'), next('message'), next('message')];

    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(4);
  });

  it('stays strictly ordered within one millisecond', () => {
    const next = createIdGenerator({ now: () => 1_700_000_000_000 });

    const ids = Array.from({ length: 1_000 }, () => next('delivery'));

    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stays ordered when the clock steps back', () => {
    const next = createIdGenerator({ now: clockAt(2_000, 1_000, 1_500) });

    const ids = [next('event'), next('event'), next('event')];

    expect([...ids].sort()).toEqual(ids);
    expect(ids.map((id) => parseId(id)?.timestamp.getTime())).toEqual([2_000, 2_000, 2_000]);
  });

  it('increments the random part within one millisecond', () => {
    const next = createIdGenerator({ now: () => 0, fillRandom: zeroRandom });

    expect([next('ship'), next('ship'), next('ship')]).toEqual([
      'shp_00000000000000000000000000',
      'shp_00000000000000000000000001',
      'shp_00000000000000000000000002',
    ]);
  });

  it('refuses to overflow the random part and never goes backwards afterwards', () => {
    const next = createIdGenerator({ now: clockAt(0, 0, 0, 1), fillRandom: maxRandom });

    const last = next('ship');

    expect(() => next('ship')).toThrow(RangeError);
    expect(() => next('ship')).toThrow(RangeError);
    expect(next('ship') > last).toBe(true);
  });

  it.each([-1, 1.5, Number.NaN, 2 ** 48])('rejects the clock value %s', (time) => {
    const next = createIdGenerator({ now: () => time });

    expect(() => next('fleet')).toThrow(RangeError);
  });

  it('draws fresh randomness by default', () => {
    const next = createIdGenerator({ now: clockAt(1, 2) });

    const [first, second] = [next('fleet'), next('fleet')];

    expect(first.slice(-16)).not.toBe(second.slice(-16));
  });
});

describe('parseId', () => {
  it('knows an operator account id', () => {
    expect(parseId('opr_01aryz6s410000000000000000')).toEqual({
      kind: 'operator',
      timestamp: new Date(1469918176385),
    });
  });

  it('returns the kind and the creation time', () => {
    const id = createIdGenerator({ now: () => 1_759_147_200_000 })('consoleSession');

    expect(parseId(id)).toEqual({ kind: 'consoleSession', timestamp: new Date(1_759_147_200_000) });
  });

  it.each([
    ['an empty string', ''],
    ['a value without a separator', 'shp01aryz6s410000000000000000'],
    ['an unknown prefix', 'usr_01aryz6s410000000000000000'],
    ['an uppercase body', 'shp_01ARYZ6S410000000000000000'],
    ['an uppercase prefix', 'SHP_01aryz6s410000000000000000'],
    ['a short body', 'shp_01aryz6s41000000000000000'],
    ['a long body', 'shp_01aryz6s4100000000000000000'],
    ['a letter outside the alphabet', 'shp_01aryz6s41000000000000000u'],
    ['a time beyond 48 bits', 'shp_81aryz6s410000000000000000'],
    ['an extra separator', 'shp__01aryz6s41000000000000000'],
  ])('rejects %s', (_label, value) => {
    expect(parseId(value)).toBeUndefined();
  });
});

describe('isId', () => {
  const id = createIdGenerator()('ship');

  it('accepts an id of the given kind', () => {
    expect(isId(id, 'ship')).toBe(true);
  });

  it('rejects an id of another kind', () => {
    expect(isId(id, 'fleet')).toBe(false);
  });

  it('rejects values that are not strings', () => {
    expect(isId(42, 'ship')).toBe(false);
    expect(isId(undefined, 'ship')).toBe(false);
  });
});

describe('ID_KINDS', () => {
  it('lists every kind of id, each with its prefix', () => {
    expect(ID_KINDS).toEqual([
      'fleet',
      'ship',
      'message',
      'delivery',
      'event',
      'lease',
      'credential',
      'operator',
      'consoleSession',
    ]);
  });

  it('gives the operator account the opr_ prefix', () => {
    expect(ID_PREFIXES.operator).toBe('opr');
  });
});

describe('idSchema', () => {
  const id = createIdGenerator()('ship');

  it('parses an id of its kind, as that kind', () => {
    expect(idSchema('ship').parse(id)).toBe(id);
  });

  it.each([
    ['an id of another kind', createIdGenerator()('fleet')],
    ['a malformed id', 'shp_not-a-ulid'],
    ['a value that is not a string', 42],
  ])('refuses %s', (_label, value) => {
    expect(idSchema('ship').safeParse(value).success).toBe(false);
  });

  it('names the kind it expected', () => {
    expect(idSchema('ship').safeParse('flt_x').error?.issues[0]?.message).toBe('must be a ship id (shp_...)');
  });

  it('describes itself in JSON Schema: a string of its prefix and a lowercase ULID, named by its kind', () => {
    expect(z.toJSONSchema(idSchema('delivery'))).toMatchObject({
      type: 'string',
      pattern: '^dlv_[0-7][0-9a-hjkmnp-tv-z]{25}$',
      description: 'A delivery id (dlv_...)',
    });
  });

  it.each(ID_KINDS)('gives %s ids a JSON Schema pattern that they match and no other kind does', (kind) => {
    const { pattern } = z.object({ pattern: z.string() }).parse(z.toJSONSchema(idSchema(kind)));
    const other = ID_KINDS.find((candidate) => candidate !== kind) ?? kind;

    expect(new RegExp(pattern).test(createIdGenerator()(kind))).toBe(true);
    expect(new RegExp(pattern).test(createIdGenerator()(other))).toBe(false);
  });
});
