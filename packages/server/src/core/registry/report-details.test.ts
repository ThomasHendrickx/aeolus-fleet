import { describe, expect, it } from 'vitest';

import { isSameJson, mergePatch } from './report-details.js';

describe('mergePatch, as RFC 7386 applies a JSON Merge Patch', () => {
  it.each([
    [{ a: 'b' }, { a: 'c' }, { a: 'c' }],
    [{ a: 'b' }, { b: 'c' }, { a: 'b', b: 'c' }],
    [{ a: 'b' }, { a: null }, {}],
    [{ a: 'b', b: 'c' }, { a: null }, { b: 'c' }],
    [{ a: ['b'] }, { a: 'c' }, { a: 'c' }],
    [{ a: 'c' }, { a: ['b'] }, { a: ['b'] }],
    [{ a: { b: 'c' } }, { a: { b: 'd', c: null } }, { a: { b: 'd' } }],
    [{ a: [{ b: 'c' }] }, { a: [1] }, { a: [1] }],
    [['a', 'b'], ['c', 'd'], ['c', 'd']],
    [{ a: 'b' }, ['c'], ['c']],
    [{ a: 'foo' }, null, null],
    [{ a: 'foo' }, 'bar', 'bar'],
    [{ e: null }, { a: 1 }, { e: null, a: 1 }],
    [[1, 2], { a: 'b', c: null }, { a: 'b' }],
    [{}, { a: { bb: { ccc: null } } }, { a: { bb: {} } }],
  ])('patches %j with %j into %j (RFC 7386, appendix A)', (...[target, patch, result]) => {
    expect(mergePatch(target, patch)).toEqual(result);
  });

  it('reads keys named like built-in properties as plain keys', () => {
    expect(mergePatch({ toString: 1 }, { constructor: { a: 1 } })).toEqual({ toString: 1, constructor: { a: 1 } });
  });

  it('leaves the target as it was', () => {
    const target = { a: { b: 'c' } };

    mergePatch(target, { a: { b: 'd' } });

    expect(target).toEqual({ a: { b: 'c' } });
  });
});

describe('isSameJson', () => {
  it('holds for the same values whatever the order of their keys', () => {
    expect(isSameJson({ a: 1, b: [1, { c: null }] }, { b: [1, { c: null }], a: 1 })).toBe(true);
  });

  it.each([
    [{ a: 1 }, { a: 2 }],
    [{ a: 1 }, { a: 1, b: 1 }],
    [[1, 2], [2, 1]],
    [{ a: null }, {}],
    [null, {}],
    [{ a: [1] }, { a: { 0: 1 } }],
  ])('fails for %j and %j', (first, second) => {
    expect(isSameJson(first, second)).toBe(false);
  });
});
