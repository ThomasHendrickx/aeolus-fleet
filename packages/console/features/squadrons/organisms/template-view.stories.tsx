import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { templateChoices } from '../../../lib/squadrons-view';
import { TemplateView } from './template-view';
import { blueprints, templates } from '../../../lib/fixtures/squadrons.fixtures';

const [implementer, planner, tester] = templateChoices({ templates });

const meta = {
  title: 'Organisms/TemplateView',
  component: TemplateView,
  args: { template: tester ?? planner ?? implementer, version: 4, onVersionChange: () => undefined, blueprints },
} satisfies Meta<typeof TemplateView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const PinnedModel: Story = { args: { template: implementer, version: 3 } };
