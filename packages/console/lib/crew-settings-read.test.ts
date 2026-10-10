import { describe, expect, it } from 'vitest';

import { parseCrewSettings } from './crew-settings-read';

describe("a crew request's settings, parsed on the web app's server", () => {
  it('are crew settings, in the order given', async () => {
    const worktree = { harness: 'claude-code', workspace: { kind: 'worktree', repository: 'aeolus-fleet' }, options: {} };
    const folder = { workspace: { kind: 'folder', name: 'notes' }, options: {} };

    await expect(parseCrewSettings([worktree, folder])).resolves.toEqual([worktree, folder]);
  });

  it('are null when they are no crew settings, as a request made without the trierarch plugin holds', async () => {
    await expect(parseCrewSettings([{}, 'not settings'])).resolves.toEqual([null, null]);
  });
});
