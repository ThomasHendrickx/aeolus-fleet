import { describe, expect, it } from 'vitest';

import { repositoryLabel } from './repository';

describe('repositoryLabel', () => {
  it('reads a github.com repository as owner/repo, with the GitHub mark', () => {
    expect(repositoryLabel('github.com/acme/templates')).toEqual({ label: 'acme/templates', isGitHub: true });
  });

  it('shows any other repository by its name', () => {
    expect(repositoryLabel('gitlab.com/acme/templates')).toEqual({ label: 'gitlab.com/acme/templates', isGitHub: false });
    expect(repositoryLabel('github.com/acme/group/templates')).toEqual({ label: 'github.com/acme/group/templates', isGitHub: false });
  });
});
