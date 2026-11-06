import { describe, expect, it } from 'vitest';

import { publicFilesProblems } from './check-public-files.ts';

const PUBLIC_FILES = ['brand/aeolus-mark-slate.svg', 'brand/aeolus-wordmark-slate.svg'];
const SHIPPED = [
  '.next/standalone/packages/console/server.js',
  '.next/standalone/packages/console/public/brand/aeolus-mark-slate.svg',
  '.next/standalone/packages/console/public/brand/aeolus-wordmark-slate.svg',
];

describe('the publish dry run check of the console public files', () => {
  it('passes a tarball that ships every file under public/ beside the server', () => {
    expect(publicFilesProblems({ publicFiles: PUBLIC_FILES, shipped: SHIPPED })).toEqual([]);
  });

  it('fails a tarball that leaves out a file under public/, as the standalone build does by itself', () => {
    expect(publicFilesProblems({ publicFiles: PUBLIC_FILES, shipped: SHIPPED.slice(0, 2) })).toEqual([
      'The tarball ships no .next/standalone/packages/console/public/brand/aeolus-wordmark-slate.svg: run the console build (scripts/standalone.ts copies public/).',
    ]);
  });
});
