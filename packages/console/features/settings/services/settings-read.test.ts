import { describe, expect, it } from 'vitest';

import { isSettingsRead } from './settings-read';

/** Every read Settings waits for answered, for argo, who manages the fleet. */
const ALL_READ = { signedInAs: 'operator', isAccountRead: true, isAppsListRead: true, canManage: true, installationReads: [true, true, true, true] } as const;

describe('isSettingsRead: Settings shows its loading shape until what it shows is read, never flipping as each query answers', () => {
  it('shows the loading shape until the session is read', () => {
    // Given no session read yet
    const reads = { ...ALL_READ, signedInAs: undefined };

    // When Settings asks whether it may show its sections
    const isRead = isSettingsRead(reads);

    // Then it shows the loading shape
    expect(isRead).toBe(false);
  });

  it('shows a viewer the loading shape, not a disabled theme switch, before the account loads', () => {
    // Given a viewer whose account is not read yet
    const reads = { ...ALL_READ, signedInAs: 'viewer', canManage: false, isAccountRead: false } as const;

    // When Settings asks whether it may show its sections
    const isRead = isSettingsRead(reads);

    // Then it shows the loading shape
    expect(isRead).toBe(false);
  });

  it("waits for an account's apps list, which names Your account", () => {
    // Given an account whose apps list is still being read
    const reads = { ...ALL_READ, signedInAs: 'account', isAppsListRead: false } as const;

    // When Settings asks whether it may show its sections
    const isRead = isSettingsRead(reads);

    // Then it shows the loading shape
    expect(isRead).toBe(false);
  });

  it('waits for how the installation runs, for a session that manages the fleet', () => {
    // Given argo with one plugin's connection still being read
    const reads = { ...ALL_READ, installationReads: [true, false, true, true] };

    // When Settings asks whether it may show its sections
    const isRead = isSettingsRead(reads);

    // Then it shows the loading shape
    expect(isRead).toBe(false);
  });

  it("waits for no installation read for a session that does not manage the fleet, nor for argo's apps list", () => {
    // Given a viewer, its account read, the plugins' connections not
    const reads = { ...ALL_READ, signedInAs: 'viewer', canManage: false, isAppsListRead: false, installationReads: [false, false, false, false] } as const;

    // When Settings asks whether it may show its sections
    const isRead = isSettingsRead(reads);

    // Then it shows its sections
    expect(isRead).toBe(true);
  });

  it('shows its sections once everything it shows is read', () => {
    expect(isSettingsRead(ALL_READ)).toBe(true);
  });
});
