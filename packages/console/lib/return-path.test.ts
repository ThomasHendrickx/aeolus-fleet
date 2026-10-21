import { describe, expect, it } from 'vitest';

import { returnPathOf } from './return-path';

describe('the page a sign-in returns to', () => {
  it.each([
    ['/', '/'],
    ['/inbox', '/inbox'],
    ['/ships/shp_01?tab=timeline#latest', '/ships/shp_01?tab=timeline#latest'],
    ['/a/../labels', '/labels'],
  ])('keeps a page of the console, %s', (path, kept) => {
    expect(returnPathOf(path)).toBe(kept);
  });

  it.each([
    ['two slashes', '//evil.example'],
    ['a slash and a backslash', '/\\evil.example'],
    ['a backslash after dot segments', '/a/..\\\\evil.example'],
    ['dot segments to two slashes', '/a/..//evil.example'],
    ['a tab between the slashes', '/\t/evil.example'],
    ['a newline between the slashes', '/\n/evil.example'],
    ['another site in full', 'https://evil.example/'],
    ['a scheme', 'javascript:alert(1)'],
    ['no leading slash', 'inbox'],
  ])('goes to the overview for %s', (_case, path) => {
    expect(returnPathOf(path)).toBe('/');
  });

  it('goes to the overview for none, and for a sign-in page, which would loop', () => {
    expect(returnPathOf(null)).toBe('/');
    expect(returnPathOf('/sign-in/start')).toBe('/');
    expect(returnPathOf('/x/../sign-in')).toBe('/');
  });
});
