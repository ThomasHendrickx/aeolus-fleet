import { idSchema } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { grantableScopes, type FleetNamespace } from './grantable-scopes';

const SQUADRONS_SHIP = { id: idSchema('ship').parse('shp_01m3tbfspe96yf1rnr4ank9h1a'), name: 'squadrons' };

/** The fleet's namespaces as fleet.scopes answers them: the core ones first, then each plugin's. */
const NAMESPACES: readonly FleetNamespace[] = [
  {
    namespace: 'messages',
    declaredBy: null,
    scopes: [
      { scope: 'messages:send', description: 'Send, answer and ask other ships' },
      { scope: 'messages:force', description: 'Send a forced message, which comes first' },
      { scope: 'messages:resend', description: 'Resend or dismiss a stuck delivery of a message its ship reads' },
    ],
  },
  {
    namespace: 'fleet',
    declaredBy: null,
    scopes: [
      { scope: 'fleet:read', description: 'Read ships, timelines, messages, labels, events and fleet-wide views' },
      { scope: 'fleet:manage', description: 'Rename, release, recrew and retire the ships it manages' },
    ],
  },
  { namespace: 'scopes', declaredBy: null, scopes: [{ scope: 'scopes:grant', description: 'Grant and revoke scopes on a live ship' }] },
  {
    namespace: 'squadrons',
    declaredBy: SQUADRONS_SHIP,
    scopes: [
      { scope: 'squadrons:form', description: 'Form a squadron by message' },
      { scope: 'squadrons:scale', description: 'Add and remove members' },
    ],
  },
];

describe('grantableScopes', () => {
  it('offers the fleet scopes commissioning grants, in their order, each with the description the fleet gives it, and no other core scope', () => {
    expect(grantableScopes(NAMESPACES, ['fleet:read', 'messages:resend', 'fleet:manage'])[0]).toEqual({
      title: 'Fleet access',
      namespace: null,
      scopes: [
        { scope: 'fleet:read', description: 'Read ships, timelines, messages, labels, events and fleet-wide views' },
        { scope: 'messages:resend', description: 'Resend or dismiss a stuck delivery of a message its ship reads' },
        { scope: 'fleet:manage', description: 'Rename, release, recrew and retire the ships it manages' },
      ],
    });
  });

  it("offers each plugin's scopes under the name of the ship that declared them, with their descriptions", () => {
    expect(grantableScopes(NAMESPACES, ['fleet:read']).slice(1)).toEqual([
      {
        title: 'squadrons',
        namespace: 'squadrons',
        scopes: [
          { scope: 'squadrons:form', description: 'Form a squadron by message' },
          { scope: 'squadrons:scale', description: 'Add and remove members' },
        ],
      },
    ]);
  });

  it('leaves out a plugin namespace that declares no scopes yet', () => {
    const empty: FleetNamespace = { namespace: 'trierarch', declaredBy: { id: idSchema('ship').parse('shp_01m3tbfspe96yf1rnr4ank9h2a'), name: 'trierarch-plugin' }, scopes: [] };

    expect(grantableScopes([...NAMESPACES, empty], ['fleet:read']).map(({ title }) => title)).toEqual(['Fleet access', 'squadrons']);
  });
});
