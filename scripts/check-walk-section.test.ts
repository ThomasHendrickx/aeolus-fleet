import { describe, expect, it } from 'vitest';

import { walkProblems } from './check-walk-section.ts';

const WITH_WALK = '## Summary\n\nx\n\n## Walk\n\n1. Open the page.';

describe('the Walk section check', () => {
  it('passes a change nobody sees without a Walk', () => {
    expect(walkProblems({ files: ['docs/blueprint.md', 'packages/core/src/domain/registry/x.ts'], body: '## Summary\n\nx' })).toEqual([]);
  });

  it.each([
    'packages/console/app/(console)/page.tsx',
    'packages/console/features/ship/ui/ship-page.tsx',
    'packages/core/src/adapters/mcp/mcp-endpoint.ts',
    'packages/core/src/adapters/trpc/fleet.ts',
    'packages/core/src/adapters/rest/rest-api.ts',
  ])('refuses a change to %s without a Walk', (file) => {
    expect(walkProblems({ files: [file], body: '## Summary\n\nx' })).toHaveLength(1);
  });

  it('passes a change a person sees when the body has a Walk, or says None with a reason', () => {
    const files = ['packages/console/features/ship/ui/ship-page.tsx'];
    expect(walkProblems({ files, body: WITH_WALK })).toEqual([]);
    expect(walkProblems({ files, body: '## Walk\n\nNone: a rename inside one component.' })).toEqual([]);
  });

  it('reads tests and stories as changes nobody sees', () => {
    const files = ['packages/console/features/ship/ui/ship-page.stories.tsx', 'packages/core/src/adapters/mcp/mcp-endpoint.test.ts'];
    expect(walkProblems({ files, body: '' })).toEqual([]);
  });
});
