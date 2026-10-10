import { SCOPES } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { accessOf, NO_ACCESS } from './access';

describe('what a console session may do', () => {
  it('is everything for the operator, whose argo holds every scope', () => {
    expect(accessOf({ kind: 'operator', scopes: [...SCOPES] })).toEqual({ canManage: true, canSend: true, canReceive: true, canDefineLabels: true, canAssignLabels: true, canEditNetwork: true, isViewer: false });
  });

  it('is reading only for a viewer, whose ship holds fleet:read alone', () => {
    expect(accessOf({ kind: 'viewer', scopes: ['fleet:read'] })).toEqual({ canManage: false, canSend: false, canReceive: false, canDefineLabels: false, canAssignLabels: false, canEditNetwork: false, isViewer: true });
  });

  it('follows each scope on its own', () => {
    expect(accessOf({ kind: 'operator', scopes: ['fleet:read', 'messages:send'] })).toMatchObject({ canManage: false, canSend: true, canReceive: false });
  });

  it('offers Define a label only with labels:define', () => {
    expect([accessOf({ kind: 'operator', scopes: ['fleet:read', 'labels:define'] }).canDefineLabels, accessOf({ kind: 'operator', scopes: ['fleet:manage'] }).canDefineLabels]).toEqual([true, false]);
  });

  it('offers Add label only with labels:assign', () => {
    expect([accessOf({ kind: 'operator', scopes: ['fleet:read', 'labels:assign'] }).canAssignLabels, accessOf({ kind: 'operator', scopes: ['labels:define'] }).canAssignLabels]).toEqual([true, false]);
  });

  it('offers the network rules only with fleet:network, as argo holds it (decision 0036)', () => {
    expect([accessOf({ kind: 'operator', scopes: ['fleet:read', 'fleet:network'] }).canEditNetwork, accessOf({ kind: 'operator', scopes: ['fleet:manage'] }).canEditNetwork]).toEqual([true, false]);
  });

  it('offers nothing until the session is known', () => {
    expect(accessOf(undefined)).toEqual(NO_ACCESS);
  });
});
