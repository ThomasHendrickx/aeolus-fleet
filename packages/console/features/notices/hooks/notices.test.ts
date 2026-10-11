import { describe, expect, it } from 'vitest';

import { afterSignOutOf } from './notices';

describe('afterSignOutOf', () => {
  it("goes to the link's url once the session ended", () => {
    expect(afterSignOutOf({ label: 'Leave', url: 'https://example.com/bye', isSignOut: true })).toBe('https://example.com/bye');
  });

  it('goes to sign in when the link has no url', () => {
    expect(afterSignOutOf({ label: 'Sign out', isSignOut: true })).toBe('/sign-in');
  });
});
