import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import type { BlueprintVersion } from '../../../lib/squadrons-schemas';
import { HandoffWiring } from './handoff-wiring';

const REPO = 'github.com/thomashendrickx/squadron-templates';

const aeolus: BlueprintVersion = {
  repository: REPO,
  name: 'aeolus',
  version: 3,
  commit: '4f2a91c0',
  committedAt: '2026-10-01T09:00:00.000Z',
  description: 'Plans, builds and tests one slice.',
  roles: [
    { name: 'planner', template: { repository: REPO, name: 'planner', version: 2 }, count: 1 },
    { name: 'implementer', template: { repository: REPO, name: 'implementer', version: 3 }, count: 2 },
    { name: 'tester', template: { repository: REPO, name: 'tester', version: 3 }, count: 1 },
  ],
  handoffs: [
    { role: 'planner', handoff: 'on-task', to: 'implementer' },
    { role: 'implementer', handoff: 'on-done', to: 'tester' },
    { role: 'tester', handoff: 'on-fail', to: 'implementer' },
    { role: 'tester', handoff: 'on-pass', to: 'flagship' },
  ],
  memberNames: 'plain',
  file: '.aeolus/squadrons/blueprints/aeolus.yaml',
};

const meta = {
  title: 'Organisms/HandoffWiring',
  component: HandoffWiring,
  args: { blueprint: aeolus },
} satisfies Meta<typeof HandoffWiring>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Squadron: Story = {};
export const Empty: Story = { args: { blueprint: { ...aeolus, handoffs: [] } } };
