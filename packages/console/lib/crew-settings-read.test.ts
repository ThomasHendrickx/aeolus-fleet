import { describe, expect, it } from 'vitest';

import { parseCrewSettings } from './crew-settings-read';

describe("a crew request's settings, parsed on the web app's server", () => {
  it('are crew settings, in the order given', async () => {
    const repositories = { harness: 'claude-code', workspace: { kind: 'repositories', main: { repository: 'aeolus-fleet' }, subRepositories: [] }, options: {} };
    const folder = { workspace: { kind: 'folder', name: 'notes' }, options: {} };

    await expect(parseCrewSettings([repositories, folder])).resolves.toEqual([repositories, folder]);
  });

  it('are null when they are no crew settings, as a request made without the trierarch plugin holds', async () => {
    await expect(parseCrewSettings([{}, 'not settings'])).resolves.toEqual([null, null]);
  });
});
