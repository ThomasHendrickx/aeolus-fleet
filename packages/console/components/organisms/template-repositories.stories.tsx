import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import type { Catalogue } from '../../lib/squadrons-api';
import { TemplateRepositories } from './template-repositories';

const NOW = new Date('2026-10-04T12:00:00.000Z');
const REPOSITORY = 'github.com/acme/squadron-templates';

function aTemplate(name: string, version: number): Catalogue['templates'][number] {
  return { repository: REPOSITORY, name, version, commit: '4f2a91c', committedAt: '2026-10-04T10:00:00.000Z', description: 'A role.', checkInMinutes: 30, model: null, launchNote: null, charter: 'You work.', handoffs: [], file: `.aeolus/squadrons/templates/${name}.yaml` };
}

/** A repository read whole: its versions, nothing left out. */
const readWhole: Catalogue = {
  templates: [aTemplate('planner', 1), aTemplate('tester', 1), aTemplate('tester', 2)],
  blueprints: [
    { repository: REPOSITORY, name: 'feature', version: 1, commit: '4f2a91c', committedAt: '2026-10-04T10:00:00.000Z', description: 'A feature.', roles: [], handoffs: [], memberNames: 'plain', file: '.aeolus/squadrons/blueprints/feature.yaml' },
  ],
  problems: [],
};

const meta = {
  title: 'Organisms/TemplateRepositories',
  component: TemplateRepositories,
  args: {
    repositories: [
      {
        name: 'github.com/acme/squadron-templates',
        url: 'https://github.com/acme/squadron-templates.git',
        path: '.aeolus/squadrons',
        hasToken: false,
        addedAt: '2026-10-03T09:00:00.000Z',
        lastFetch: { at: '2026-10-04T11:58:00.000Z', error: null },
      },
      {
        name: 'gitlab.example.com/ops/fleet',
        url: 'https://gitlab.example.com/ops/fleet.git',
        path: 'ops/fleet',
        hasToken: true,
        addedAt: '2026-10-03T09:00:00.000Z',
        lastFetch: { at: '2026-10-04T11:58:00.000Z', error: 'git fetch: could not resolve host' },
      },
    ],
    catalogue: readWhole,
    state: 'ready',
    onRetry: () => undefined,
    isAdding: false,
    onAdd: () => undefined,
    isRemoving: false,
    onRemove: () => undefined,
    onRemoveClosed: () => undefined,
    isRefreshing: false,
    onRefresh: () => undefined,
    now: NOW,
  },
} satisfies Meta<typeof TemplateRepositories>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Empty: Story = { args: { repositories: [] } };
export const Loading: Story = { args: { state: 'loading' } };
export const Error: Story = { args: { state: 'error', error: 'squadrons did not answer.' } };
export const AddRefused: Story = { args: { addError: 'A repository URL must be https.' } };
export const LeftOut: Story = {
  args: {
    catalogue: {
      ...readWhole,
      problems: [
        { repository: REPOSITORY, kind: 'tag', name: 'Reviewer', version: 1, message: 'the tag Reviewer@1 names no template or blueprint: a version tag is <name>@<n>, its name in lowercase as the file is named, such as reviewer@1' },
        { repository: REPOSITORY, kind: 'template', name: 'tester', version: 3, message: 'checkIn must be a duration such as 30m or 2h' },
        {
          repository: REPOSITORY,
          kind: 'blueprint',
          name: 'release',
          version: 2,
          message: 'roles.tester.template: squadrons knows no repository github.com/Acme/squadron-templates; it knows github.com/acme/squadron-templates, and a reference must match its name exactly, letter case too',
        },
      ],
    },
  },
};
export const NothingFound: Story = { args: { catalogue: { templates: [], blueprints: [], problems: [] } } };
