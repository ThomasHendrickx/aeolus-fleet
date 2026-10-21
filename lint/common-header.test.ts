import { describe, expect, it } from 'vitest';

import { createLint, reportsOf } from './support/lint-probe.ts';

// @aeolus-fleet/common/header is React for the browser and client-safe
// (header design H2, decision 0033): it imports no zod, schema, Node built-in
// or server code, and takes the rest of common as types only. The rest of
// common never imports React or the header, so server-only users never load it.

const headerProbe = 'packages/common/src/header/boundary-probe.ts';
const commonProbe = 'packages/common/src/fleet/boundary-probe.ts';
const lint = createLint({ tsconfig: 'packages/common/tsconfig.json', probes: [headerProbe, commonProbe] });

async function boundaryViolations(code: string, path: string): Promise<string[]> {
  const messages = await lint(code, path);
  return [...reportsOf(messages, 'no-restricted-imports'), ...reportsOf(messages, 'no-restricted-syntax')];
}

describe('the header imports nothing that is not client-safe', () => {
  it.each([
    ['zod', "import { z } from 'zod';"],
    ['a Node built-in', "import { readFileSync } from 'node:fs';"],
    ['the tRPC server', "import { initTRPC } from '@trpc/server';"],
    ["common's schemas", "import { appsListSchema } from '../schemas/apps-list.js';"],
    ["common's ids", "import { createIdGenerator } from '../ids/index.js';"],
    ["common's fleet", "import { mcpUrlOf } from '../fleet/index.js';"],
    ["common's trierarch", "import * as trierarch from '../trierarch/index.js';"],
    ["common's root", "import { appsListSchema } from '../index.js';"],
    ["common's root through a re-export", "export { appsListSchema } from '../index.js';"],
    ["common's root through import()", "export const load = () => import('../index.js');"],
  ])('fails when the header imports %s', async (_label, code) => {
    const violations = await boundaryViolations(code, headerProbe);

    expect(violations).toEqual([expect.stringContaining('@aeolus-fleet/common/header')]);
  });

  it.each([
    ["a type from common's root", "import type { AppsList } from '../index.js';"],
    ["a type from common's schemas", "import type { AppsList } from '../schemas/apps-list.js';"],
    ['React', "import { useState } from 'react';"],
    ['Base UI', "import { Menu } from '@base-ui/react/menu';"],
    ['the rules', "import { plainHttpWarning } from '../rules/index.js';"],
    ['another header module', "import { Button } from './atoms/button.js';"],
  ])('passes when the header imports %s', async (_label, code) => {
    await expect(boundaryViolations(code, headerProbe)).resolves.toEqual([]);
  });
});

describe('the rest of common never imports React or the header', () => {
  it.each([
    ['React', "import { useState } from 'react';"],
    ['React DOM', "import { createPortal } from 'react-dom';"],
    ['Base UI', "import { Menu } from '@base-ui/react/menu';"],
    ['lucide', "import { Ship } from 'lucide-react';"],
    ['the header', "import { Button } from '../header/index.js';"],
  ])('fails when common imports %s', async (_label, code) => {
    const violations = await boundaryViolations(code, commonProbe);

    expect(violations).toEqual([expect.stringContaining('@aeolus-fleet/common/header')]);
  });

  it('passes when common imports zod', async () => {
    await expect(boundaryViolations("import { z } from 'zod';", commonProbe)).resolves.toEqual([]);
  });
});
