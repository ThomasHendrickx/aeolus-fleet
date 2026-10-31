import { describe, expect, it } from 'vitest';

import { createLint, reportsOf } from './support/lint-probe.ts';

// @aeolus-fleet/ui is pure UI for the browser (UI package design UP4, 5.4):
// it imports no app and no @aeolus-fleet package but common, common by import
// type only, nothing that is not client-safe, and reads no data. A layer
// imports only below itself. Common holds no React and never imports ui.

const probes = {
  root: 'packages/ui/src/boundary-probe.ts',
  atom: 'packages/ui/src/atoms/layer-probe.tsx',
  molecule: 'packages/ui/src/molecules/layer-probe.tsx',
  organism: 'packages/ui/src/organisms/layer-probe.tsx',
  story: 'packages/ui/src/atoms/layer-probe.stories.tsx',
  common: 'packages/common/src/fleet/boundary-probe.ts',
};
const lint = createLint({ tsconfig: 'packages/ui/tsconfig.json', probes: Object.values(probes) });

async function boundaryViolations(code: string, path: string): Promise<string[]> {
  const messages = await lint(code, path);
  return [...reportsOf(messages, 'no-restricted-imports'), ...reportsOf(messages, 'no-restricted-syntax')];
}

describe('ui imports no app and nothing that is not client-safe', () => {
  it.each([
    ['zod', "import { z } from 'zod';"],
    ['a Node built-in', "import { readFileSync } from 'node:fs';"],
    ['the tRPC server', "import { initTRPC } from '@trpc/server';"],
    ['TanStack Query', "import { useQuery } from '@tanstack/react-query';"],
    ['Next.js', "import Link from 'next/link';"],
    ['the console', "import { anything } from '@aeolus-fleet/console';"],
    ['core', "import type { AppRouter } from '@aeolus-fleet/core';"],
    ['another @aeolus-fleet package', "import type { Anything } from '@aeolus-fleet/squadrons';"],
    ["common's schemas as a value", "import { appsListSchema } from '@aeolus-fleet/common';"],
    ["common's rules as a value", "import { appSwitcherOf } from '@aeolus-fleet/common/rules';"],
    ['common through a re-export', "export { appsListSchema } from '@aeolus-fleet/common';"],
    ['common through import()', "export const load = () => import('@aeolus-fleet/common');"],
  ])('fails when ui imports %s', async (_label, code) => {
    const violations = await boundaryViolations(code, probes.root);

    expect(violations).toEqual([expect.stringContaining('@aeolus-fleet/ui is pure UI')]);
  });

  it.each([
    ["a type from common's root", "import type { Theme } from '@aeolus-fleet/common';"],
    ["a type from common's rules", "import type { AppSwitcherModel } from '@aeolus-fleet/common/rules';"],
    ['React', "import { useState } from 'react';"],
    ['Base UI', "import { Menu } from '@base-ui/react/menu';"],
    ['lucide', "import { Ship } from 'lucide-react';"],
  ])('passes when ui imports %s', async (_label, code) => {
    await expect(boundaryViolations(code, probes.root)).resolves.toEqual([]);
  });

  it("lets a story build its props from common's values, as stories never ship", async () => {
    await expect(boundaryViolations("import { appSwitcherOf } from '@aeolus-fleet/common/rules';", probes.story)).resolves.toEqual([]);
  });
});

describe('ui reads no data', () => {
  it.each([
    { label: 'fetch', code: "export const read = () => fetch('/api');", rule: 'no-restricted-globals' },
    { label: 'window.fetch', code: "export const read = () => window.fetch('/api');", rule: 'no-restricted-properties' },
    { label: 'localStorage', code: "export const read = () => localStorage.getItem('theme');", rule: 'no-restricted-globals' },
    { label: 'window.sessionStorage', code: "export const read = () => window.sessionStorage.getItem('theme');", rule: 'no-restricted-properties' },
  ])('refuses $label', async ({ code, rule }) => {
    expect(reportsOf(await lint(code, probes.molecule), rule)).toHaveLength(1);
  });
});

describe('a layer imports only below itself', () => {
  it.each([
    { layer: 'an atom', other: 'a molecule', path: probes.atom, code: "import { AvatarMenu } from '../molecules/avatar-menu.js';" },
    { layer: 'an atom', other: 'an organism', path: probes.atom, code: "import { AppHeader } from '../organisms/app-header.js';" },
    { layer: 'a molecule', other: 'an organism', path: probes.molecule, code: "import { AppHeader } from '../organisms/app-header.js';" },
  ])('fails when $layer imports $other', async ({ path, code }) => {
    await expect(boundaryViolations(code, path)).resolves.toEqual([expect.stringContaining('atomic design imports downward only')]);
  });

  it.each([
    { layer: 'a molecule', other: 'an atom', path: probes.molecule, code: "import { Button } from '../atoms/button.js';" },
    { layer: 'an organism', other: 'a molecule', path: probes.organism, code: "import { AvatarMenu } from '../molecules/avatar-menu.js';" },
    { layer: 'an atom', other: 'the class merge helper', path: probes.atom, code: "import { classNames } from '../class-names.js';" },
  ])('passes when $layer imports $other', async ({ path, code }) => {
    await expect(boundaryViolations(code, path)).resolves.toEqual([]);
  });
});

describe('ui keeps the React rules of the console', () => {
  it('refuses manual memoisation', async () => {
    await expect(boundaryViolations("import { useMemo } from 'react';", probes.molecule)).resolves.toEqual([
      expect.stringContaining('No manual memoisation'),
    ]);
  });

  it('refuses an index as a key', async () => {
    const code = "export const List = ({ names }: { names: string[] }) => <ul>{names.map((name, index) => <li key={index}>{name}</li>)}</ul>;";

    expect(reportsOf(await lint(code, probes.molecule), 'react-x/no-array-index-key')).toHaveLength(1);
  });
});

describe('common holds no React and never imports ui', () => {
  it.each([
    ['React', "import { useState } from 'react';"],
    ['React DOM', "import { createPortal } from 'react-dom';"],
    ['Base UI', "import { Menu } from '@base-ui/react/menu';"],
    ['lucide', "import { Ship } from 'lucide-react';"],
    ['ui', "import { Button } from '@aeolus-fleet/ui';"],
  ])('fails when common imports %s', async (_label, code) => {
    const violations = await boundaryViolations(code, probes.common);

    expect(violations).toEqual([expect.stringContaining('common holds no React')]);
  });

  it('passes when common imports zod', async () => {
    await expect(boundaryViolations("import { z } from 'zod';", probes.common)).resolves.toEqual([]);
  });
});
