import { describe, expect, it } from 'vitest';

import { createLint, reportsOf } from './support/lint-probe.ts';

// A context reaches another context only through its public.ts; shared is open
// to all (docs/architecture.md, "Code structure").

const probes = {
  identity: 'packages/core/src/domain/identity/contexts-probe.ts',
  registry: 'packages/core/src/domain/registry/contexts-probe.ts',
  messaging: 'packages/core/src/domain/messaging/contexts-probe.ts',
  shared: 'packages/core/src/domain/shared/contexts-probe.ts',
  unlisted: 'packages/core/src/domain/contexts-probe.ts',
};
const lint = createLint({ tsconfig: 'packages/core/tsconfig.json', probes: Object.values(probes) });

async function contextViolations(code: string, path: string): Promise<string[]> {
  const messages = await lint(code, path);
  return [...reportsOf(messages, 'no-restricted-imports'), ...reportsOf(messages, 'no-restricted-syntax')].filter(
    (message) => message.includes('its published surface'),
  );
}

describe('context boundaries in the core', () => {
  it.each([
    { label: 'identity imports a registry module', path: probes.identity, code: "import { location } from '../registry/lease.js';" },
    {
      label: 'identity imports the registry through a barrel',
      path: probes.identity,
      code: "import { endLease } from '../registry/index.js';",
    },
    {
      label: 'identity imports a public.ts nested in the registry',
      path: probes.identity,
      code: "import { x } from '../registry/leases/public.js';",
    },
    {
      label: 'registry imports an identity module',
      path: probes.registry,
      code: "import { issueShipSecret } from '../identity/credential.js';",
    },
    { label: 'messaging imports a registry module', path: probes.messaging, code: "import type { Ship } from '../registry/ship.js';" },
    {
      label: 'shared imports an identity module',
      path: probes.shared,
      code: "import type { Credential } from '../identity/credential.js';",
    },
    {
      label: 'a core file outside the context folders imports a registry module',
      path: probes.unlisted,
      code: "import { location } from './registry/lease.js';",
    },
    {
      label: 'identity loads a registry module with import()',
      path: probes.identity,
      code: "export const load = () => import('../registry/lease.js');",
    },
    {
      label: 'identity names a registry type with import()',
      path: probes.identity,
      code: "export type Ship = import('../registry/ship.js').Ship;",
    },
  ])('refuses: $label', async ({ code, path }) => {
    const violations = await contextViolations(code, path);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/Outside domain\/\w+, import it only through \w+\/public\.js, its published surface/);
  });

  it.each([
    { label: 'identity imports the registry public.ts', path: probes.identity, code: "import { endLease } from '../registry/public.js';" },
    {
      label: 'registry imports the identity public.ts',
      path: probes.registry,
      code: "import { issueShipSecret } from '../identity/public.js';",
    },
    {
      label: 'a core file outside the context folders imports the registry public.ts',
      path: probes.unlisted,
      code: "import { endLease } from './registry/public.js';",
    },
    { label: 'a context imports shared', path: probes.messaging, code: "import type { Clock } from '../shared/clock.js';" },
    { label: 'a context imports its own modules', path: probes.identity, code: "import { CONSOLE_LOCATION } from './console-session.js';" },
  ])('allows: $label', async ({ code, path }) => {
    await expect(contextViolations(code, path)).resolves.toEqual([]);
  });
});
