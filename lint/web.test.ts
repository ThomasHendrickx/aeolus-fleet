import { describe, expect, it } from 'vitest';

import { createLint, reportsOf } from './support/lint-probe.ts';

// The console (web-frontend skill): vertical by feature, atomic design inside
// each; shared components take props only and import downward; shared code
// never imports a feature or app/, and no feature imports another; a new
// feature uses ui/, state/, hooks/ and services/, while a feature not yet moved
// keeps its atoms/, molecules/, organisms/ and lib/; no browser storage, no
// manual memoisation, stable keys and accessible markup.

const probes = {
  atom: 'packages/console/components/atoms/layer-probe.tsx',
  molecule: 'packages/console/components/molecules/layer-probe.tsx',
  organism: 'packages/console/components/organisms/layer-probe.tsx',
  featureAtom: 'packages/console/features/probe/atoms/layer-probe.tsx',
  featureMolecule: 'packages/console/features/probe/molecules/layer-probe.tsx',
  featureOrganism: 'packages/console/features/probe/organisms/layer-probe.tsx',
  featureHook: 'packages/console/features/probe/hooks/hook-probe.ts',
  uiAtom: 'packages/console/features/probe/ui/atoms/layer-probe.tsx',
  uiMolecule: 'packages/console/features/probe/ui/molecules/layer-probe.tsx',
  uiOrganism: 'packages/console/features/probe/ui/organisms/layer-probe.tsx',
  state: 'packages/console/features/probe/state/state-probe.tsx',
  service: 'packages/console/features/probe/services/service-probe.ts',
  newFeatureRoot: 'packages/console/features/probe/root-probe.ts',
  newFeatureUiRoot: 'packages/console/features/probe/ui/ui-probe.tsx',
  newFeatureOrganism: 'packages/console/features/probe/organisms/organism-probe.tsx',
  newFeatureLib: 'packages/console/features/probe/lib/lib-probe.ts',
  oldFeatureOrganism: 'packages/console/features/compose/organisms/organism-probe.tsx',
  oldFeatureLib: 'packages/console/features/compose/lib/lib-probe.ts',
  page: 'packages/console/app/probe/page.tsx',
  lib: 'packages/console/lib/web-probe.ts',
};
const lint = createLint({ tsconfig: 'packages/console/tsconfig.json', probes: Object.values(probes) });

async function importViolations(code: string, path: string): Promise<string[]> {
  const messages = await lint(code, path);
  return [...reportsOf(messages, 'no-restricted-imports'), ...reportsOf(messages, 'no-restricted-syntax')];
}

const tRPC = [
  { label: 'the tRPC hook', from: '../../lib/trpc' },
  { label: 'a tRPC package', from: '@trpc/client' },
  { label: "the server's router type", from: '@aeolus-fleet/core' },
];

describe('shared components take props only', () => {
  it.each(tRPC)('refuses $label in a shared atom, molecule and organism', async ({ from }) => {
    for (const path of [probes.atom, probes.molecule, probes.organism]) {
      await expect(importViolations(`import { anything } from '${from}';`, path)).resolves.toEqual([
        expect.stringContaining('take props only'),
      ]);
    }
  });
});

describe("a feature's atoms and molecules take props only", () => {
  it.each(tRPC)('refuses $label', async ({ from }) => {
    const relative = from.replace('../../lib/', '../../../lib/');
    for (const path of [probes.featureAtom, probes.featureMolecule]) {
      await expect(importViolations(`import { anything } from '${relative}';`, path)).resolves.toEqual([
        expect.stringContaining('take props only'),
      ]);
    }
  });

  it("refuses the feature's hooks", async () => {
    for (const path of [probes.featureAtom, probes.featureMolecule]) {
      await expect(importViolations("import { useProbe } from '../hooks/hook-probe';", path)).resolves.toEqual([
        expect.stringContaining('take props only'),
      ]);
    }
  });

  it("allows a feature's organism its hooks and the tRPC hook", async () => {
    await expect(importViolations("import { useProbe } from '../hooks/hook-probe';", probes.featureOrganism)).resolves.toEqual([]);
    await expect(importViolations("import { useTRPC } from '../../../lib/trpc';", probes.featureOrganism)).resolves.toEqual([]);
  });
});

describe('a new feature uses ui/, state/, hooks/ and services/', () => {
  const placement = async (path: string) => reportsOf(await lint('export const probe = 1;\n', path), 'check-file/folder-match-with-fex');

  it.each([
    { label: 'its organisms/', path: probes.newFeatureOrganism },
    { label: 'its lib/', path: probes.newFeatureLib },
    { label: 'its root', path: probes.newFeatureRoot },
    { label: 'ui/ itself, outside an atomic layer', path: probes.newFeatureUiRoot },
  ])('refuses a file in $label', async ({ path }) => {
    await expect(placement(path)).resolves.toEqual([expect.stringContaining('A new feature uses ui/')]);
  });

  it.each([
    { label: 'ui/atoms/', path: probes.uiAtom },
    { label: 'ui/molecules/', path: probes.uiMolecule },
    { label: 'ui/organisms/', path: probes.uiOrganism },
    { label: 'state/', path: probes.state },
    { label: 'hooks/', path: probes.featureHook },
    { label: 'services/', path: probes.service },
  ])('allows a file in $label', async ({ path }) => {
    await expect(placement(path)).resolves.toEqual([]);
  });

  it.each([
    { label: 'its organisms/', path: probes.oldFeatureOrganism },
    { label: 'its lib/', path: probes.oldFeatureLib },
  ])('allows a feature not yet moved a file in $label', async ({ path }) => {
    await expect(placement(path)).resolves.toEqual([]);
  });
});

describe("a feature's ui/ takes props only", () => {
  it.each(tRPC)('refuses $label', async ({ from }) => {
    const relative = from.replace('../../lib/', '../../../../lib/');
    for (const path of [probes.uiAtom, probes.uiMolecule, probes.uiOrganism]) {
      await expect(importViolations(`import { anything } from '${relative}';`, path)).resolves.toEqual([
        expect.stringContaining('take props only'),
      ]);
    }
  });

  it.each([
    { label: "the feature's hooks", code: "import { useProbe } from '../../hooks/hook-probe';" },
    { label: "the feature's state", code: "import { ProbeContainer } from '../../state/state-probe';" },
  ])('refuses $label', async ({ code }) => {
    for (const path of [probes.uiAtom, probes.uiMolecule, probes.uiOrganism]) {
      await expect(importViolations(code, path)).resolves.toEqual([expect.stringContaining('take props only')]);
    }
  });

  it.each([
    { label: "the feature's services", code: "import { format } from '../../services/service-probe';" },
    { label: 'a shared atom', code: "import { Button } from '../../../../components/atoms/button';" },
  ])('allows $label', async ({ code }) => {
    await expect(importViolations(code, probes.uiOrganism)).resolves.toEqual([]);
  });
});

describe("a feature's state/ composes its hooks and ui/", () => {
  it('allows its hooks and ui/', async () => {
    const code = "import { useProbe } from '../hooks/hook-probe';\nimport { List } from '../ui/organisms/list';";

    await expect(importViolations(code, probes.state)).resolves.toEqual([]);
  });
});

describe('atomic design imports downward only', () => {
  it.each([
    { label: 'a shared atom imports a molecule', path: probes.atom, code: "import { StatusBadge } from '../molecules/status-badge';" },
    { label: 'a shared atom imports an organism', path: probes.atom, code: "import { Header } from '../organisms/header';" },
    { label: 'a shared molecule imports an organism', path: probes.molecule, code: "import { Header } from '../organisms/header';" },
    { label: "a feature's atom imports its molecule", path: probes.featureAtom, code: "import { Row } from '../molecules/row';" },
    { label: "a feature's atom imports its organism", path: probes.featureAtom, code: "import { List } from '../organisms/list';" },
    { label: "a feature's molecule imports its organism", path: probes.featureMolecule, code: "import { List } from '../organisms/list';" },
    { label: "a feature's ui atom imports its ui molecule", path: probes.uiAtom, code: "import { Row } from '../molecules/row';" },
    { label: "a feature's ui molecule imports its ui organism", path: probes.uiMolecule, code: "import { List } from '../organisms/list';" },
  ])('refuses: $label', async ({ code, path }) => {
    await expect(importViolations(code, path)).resolves.toEqual([expect.stringContaining('atomic design imports downward only')]);
  });

  it.each([
    { label: 'a shared molecule imports an atom', path: probes.molecule, code: "import { Button } from '../atoms/button';" },
    { label: 'a shared organism imports a molecule', path: probes.organism, code: "import { StatusBadge } from '../molecules/status-badge';" },
    { label: "a feature's molecule imports its atom", path: probes.featureMolecule, code: "import { Dot } from '../atoms/dot';" },
    { label: "a feature's organism imports its molecule", path: probes.featureOrganism, code: "import { Row } from '../molecules/row';" },
    { label: "a feature's organism imports a shared organism", path: probes.featureOrganism, code: "import { Header } from '../../../components/organisms/header';" },
    { label: "a feature's ui organism imports its ui molecule", path: probes.uiOrganism, code: "import { Row } from '../molecules/row';" },
  ])('allows: $label', async ({ code, path }) => {
    await expect(importViolations(code, path)).resolves.toEqual([]);
  });
});

describe('shared code never imports a feature or app/', () => {
  it.each([
    { label: 'a shared atom imports a feature', path: probes.atom, code: "import { FleetTable } from '../../features/fleet/ui/organisms/fleet-table';" },
    { label: 'a shared organism imports a feature', path: probes.organism, code: "import { FleetTable } from '../../features/fleet/ui/organisms/fleet-table';" },
    { label: 'a shared organism imports a page', path: probes.organism, code: "import Page from '../../app/page';" },
    { label: 'lib imports a feature', path: probes.lib, code: "import { useProbe } from '../features/probe/hooks/hook-probe';" },
    { label: 'lib imports a page', path: probes.lib, code: "import Page from '../app/page';" },
  ])('refuses: $label', async ({ code, path }) => {
    await expect(importViolations(code, path)).resolves.toEqual([expect.stringContaining('never imports a feature or app/')]);
  });
});

describe('no feature imports another', () => {
  it.each([
    { label: "an organism imports another feature's organism", path: probes.featureOrganism, code: "import { ShipActions } from '../../ship-actions/organisms/ship-actions';" },
    { label: "a hook imports another feature's hook", path: probes.featureHook, code: "import { useSendMessage } from '../../compose/hooks/compose';" },
    { label: "a ui organism imports another feature's ui", path: probes.uiOrganism, code: "import { Row } from '../../../compose/ui/molecules/row';" },
    { label: "a state container imports another feature's state", path: probes.state, code: "import { Compose } from '../../compose/state/compose';" },
  ])('refuses: $label', async ({ code, path }) => {
    await expect(importViolations(code, path)).resolves.toEqual([expect.stringContaining('A feature never imports another')]);
  });

  it.each([
    { label: 'a page composes features', path: probes.page, code: "import { ShipActions } from '../../features/ship-actions/organisms/ship-actions';" },
    { label: 'a feature imports shared lib', path: probes.featureHook, code: "import { useFleetSnapshot } from '../../../lib/fleet';" },
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
