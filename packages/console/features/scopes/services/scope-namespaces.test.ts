import { describe, expect, it } from 'vitest';

import { namespaceSectionsOf, type ListedNamespace } from './scope-namespaces';

const MESSAGES: ListedNamespace = { namespace: 'messages', kind: 'core', declaredBy: null, scopes: [{ scope: 'messages:send', description: 'Send, answer and ask other ships' }] };
const SQUADRONS: ListedNamespace = {
  namespace: 'squadrons',
  kind: 'plugin',
  declaredBy: { id: 'shp_01m3tbfspe96yf1rnr4ank9h1a', name: 'squadrons-plugin' },
  scopes: [{ scope: 'squadrons:form', description: 'Form a squadron by message' }],
};
const CRM: ListedNamespace = { namespace: 'crm', kind: 'fleet', declaredBy: null, scopes: [{ scope: 'crm:read-leads', description: 'Read leads in the CRM' }] };

describe('namespaceSectionsOf', () => {
  it('says whose each namespace is: core, the plugin ship that declared it, or the fleet', () => {
    expect(namespaceSectionsOf([MESSAGES, SQUADRONS, CRM]).map(({ namespace, whose }) => `${namespace}: ${whose}`)).toEqual([
      'messages: Core',
      'squadrons: Declared by squadrons-plugin',
      "crm: The fleet's own",
    ]);
  });

  it("lets only the fleet's own scopes be changed", () => {
    expect(namespaceSectionsOf([MESSAGES, SQUADRONS, CRM]).map(({ isFleetOwn }) => isFleetOwn)).toEqual([false, false, true]);
  });

  it('keeps each scope with its description', () => {
    expect(namespaceSectionsOf([CRM])[0]?.scopes).toEqual([{ scope: 'crm:read-leads', description: 'Read leads in the CRM' }]);
  });
});
