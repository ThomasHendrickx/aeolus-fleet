import { describe, expect, it } from 'vitest';

import { noticesProblems } from './check-third-party-notices.ts';
import { noticesText, type NoticedPackage } from './third-party-notices.ts';

const next: NoticedPackage = { name: 'next', version: '16.3.8', license: 'MIT', licenceTexts: ['The MIT License (MIT)'] };
const react: NoticedPackage = { name: 'react', version: '19.3.0', license: 'MIT', licenceTexts: ['MIT License'] };
const SHIPPED = ['.next/standalone/THIRD_PARTY_NOTICES', '.next/standalone/packages/console/server.js'];

describe('the publish dry run check of the console notices', () => {
  it('passes notices the tarball ships, naming every package found now', () => {
    expect(noticesProblems({ shipped: SHIPPED, notices: noticesText([next, react]), packages: [next, react] })).toEqual([]);
  });

  it('fails a tarball without the notices', () => {
    expect(noticesProblems({ shipped: SHIPPED.slice(1), notices: undefined, packages: [next] })).toEqual([
      'The tarball ships no .next/standalone/THIRD_PARTY_NOTICES: run the console build (scripts/standalone.ts writes it).',
    ]);
  });

  it('fails notices that leave out a package found now, as after a dependency changed since the build', () => {
    expect(noticesProblems({ shipped: SHIPPED, notices: noticesText([next]), packages: [next, react] })).toEqual([
      'THIRD_PARTY_NOTICES leaves out react 19.3.0: run the console build again.',
    ]);
  });

  it('fails a package that states no licence and ships no licence file', () => {
    const unknown: NoticedPackage = { name: 'mystery', version: '1.0.0', license: 'not stated', licenceTexts: [] };

    expect(noticesProblems({ shipped: SHIPPED, notices: noticesText([unknown]), packages: [unknown] })).toEqual([
      'mystery 1.0.0 states no licence and ships no licence file: find its licence before publishing.',
    ]);
  });
});
