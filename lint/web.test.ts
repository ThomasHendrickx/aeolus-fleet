import { describe, expect, it } from 'vitest';

import { createLint, reportsOf } from './support/lint-probe.ts';

// The console: atomic design layers import downward only, atoms and molecules
// take props only, no browser storage, no manual memoisation, stable keys and
// accessible markup (web-frontend skill).

const probes = {
  atom: 'packages/console/components/atoms/layer-probe.tsx',
  molecule: 'packages/console/components/molecules/layer-probe.tsx',
  organism: 'packages/console/components/organisms/layer-probe.tsx',
  template: 'packages/console/components/templates/layer-probe.tsx',
  page: 'packages/console/app/probe/page.tsx',
  lib: 'packages/console/lib/web-probe.ts',
};
const lint = createLint({ tsconfig: 'packages/console/tsconfig.json', probes: Object.values(probes) });

async function importViolations(code: string, path: string): Promise<string[]> {
  const messages = await lint(code, path);
  return [...reportsOf(messages, 'no-restricted-imports'), ...reportsOf(messages, 'no-restricted-syntax')];
}

describe('atoms and molecules take props only', () => {
  it.each([
    { label: 'the tRPC hook', code: "import { useTRPC } from '../../lib/trpc';" },
    { label: 'a tRPC package', code: "import { createTRPCClient } from '@trpc/client';" },
    { label: "the server's router type", code: "import type { AppRouter } from '@aeolus-fleet/core';" },
  ])('refuses $label in an atom and in a molecule', async ({ code }) => {
    for (const path of [probes.atom, probes.molecule]) {
      await expect(importViolations(code, path)).resolves.toEqual([
        expect.stringContaining('Atoms and molecules take props only: no tRPC'),
      ]);
    }
  });

  it('allows an organism the tRPC hook', async () => {
    await expect(importViolations("import { useTRPC } from '../../lib/trpc';", probes.organism)).resolves.toEqual([]);
  });
});

describe('atomic design imports downward only', () => {
  it.each([
    { label: 'an atom imports a molecule', path: probes.atom, code: "import { StatusBadge } from '../molecules/status-badge';" },
    { label: 'an atom imports an organism', path: probes.atom, code: "import { Fleet } from '../organisms/fleet';" },
    { label: 'an atom imports a template', path: probes.atom, code: "import { Shell } from '../templates/shell';" },
    { label: 'an atom imports a page', path: probes.atom, code: "import Page from '../../app/page';" },
    { label: 'a molecule imports an organism', path: probes.molecule, code: "import { Fleet } from '../organisms/fleet';" },
    { label: 'a molecule imports a template', path: probes.molecule, code: "import { Shell } from '../templates/shell';" },
    { label: 'an organism imports a template', path: probes.organism, code: "import { Shell } from '../templates/shell';" },
    { label: 'a template imports a page', path: probes.template, code: "import Page from '../../app/page';" },
  ])('refuses: $label', async ({ code, path }) => {
    await expect(importViolations(code, path)).resolves.toEqual([
      expect.stringContaining('atomic design imports downward only'),
    ]);
  });

  it.each([
    { label: 'a molecule imports an atom', path: probes.molecule, code: "import { Button } from '../atoms/button';" },
    { label: 'an organism imports a molecule', path: probes.organism, code: "import { StatusBadge } from '../molecules/status-badge';" },
    { label: 'a template imports an organism', path: probes.template, code: "import { Fleet } from '../organisms/fleet';" },
    { label: 'a page imports a template', path: probes.page, code: "import { Shell } from '../../components/templates/shell';" },
  ])('allows: $label', async ({ code, path }) => {
    await expect(importViolations(code, path)).resolves.toEqual([]);
  });
});

describe('no browser storage', () => {
  it.each([
    { label: 'localStorage', code: "export const read = () => localStorage.getItem('secret');", rule: 'no-restricted-globals' },
    { label: 'sessionStorage', code: "export const read = () => sessionStorage.getItem('tab');", rule: 'no-restricted-globals' },
    {
      label: 'window.localStorage',
      code: "export const read = () => window.localStorage.getItem('secret');",
      rule: 'no-restricted-properties',
    },
    {
      label: 'globalThis.sessionStorage',
      code: "export const read = () => globalThis.sessionStorage.getItem('tab');",
      rule: 'no-restricted-properties',
    },
  ])('refuses $label', async ({ code, rule }) => {
    for (const path of [probes.lib, probes.organism]) {
      expect(reportsOf(await lint(code, path), rule)).toEqual([
        expect.stringContaining('The console keeps no state in browser storage'),
      ]);
    }
  });
});

describe('no manual memoisation', () => {
  it.each(['useMemo', 'useCallback', 'memo'])('refuses importing %s from react', async (name) => {
    await expect(importViolations(`import { ${name} } from 'react';`, probes.organism)).resolves.toEqual([
      expect.stringContaining('No manual memoisation'),
    ]);
  });

  it.each(['useMemo', 'useCallback', 'memo'])('refuses React.%s', async (name) => {
    const code = `import * as React from 'react';\nexport const hook = React.${name};`;

    expect(reportsOf(await lint(code, probes.organism), 'no-restricted-properties')).toEqual([
      expect.stringContaining('No manual memoisation'),
    ]);
  });

  it('allows the other hooks', async () => {
    await expect(importViolations("import { useState } from 'react';", probes.organism)).resolves.toEqual([]);
  });
});

describe('lists and accessibility', () => {
  it('refuses an array index as a key', async () => {
    const code = `export function Ships({ names }: { names: string[] }) {
  return <ul>{names.map((name, index) => <li key={index}>{name}</li>)}</ul>;
}
`;

    expect(reportsOf(await lint(code, probes.molecule), 'react-x/no-array-index-key')).toHaveLength(1);
  });

  it('allows a key from the item', async () => {
    const code = `export function Ships({ ships }: { ships: { id: string; name: string }[] }) {
  return <ul>{ships.map((ship) => <li key={ship.id}>{ship.name}</li>)}</ul>;
}
`;

    expect(reportsOf(await lint(code, probes.molecule), 'react-x/no-array-index-key')).toEqual([]);
  });

  it.each([
    { label: 'an image without alt text', code: 'export const Logo = () => <img src="/logo.png" />;', rule: 'jsx-a11y-x/alt-text' },
    { label: 'an empty link', code: 'export const Home = () => <a href="/" />;', rule: 'jsx-a11y-x/anchor-has-content' },
    {
      label: 'a click without a keyboard equivalent',
      code: 'export const Row = ({ open }: { open: () => void }) => <div onClick={open}>ship</div>;',
      rule: 'jsx-a11y-x/click-events-have-key-events',
    },
  ])('refuses $label', async ({ code, rule }) => {
    expect(reportsOf(await lint(code, probes.atom), rule)).toHaveLength(1);
  });
});
