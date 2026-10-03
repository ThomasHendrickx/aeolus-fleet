import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { blueprints, crewLines, forming, sailing, templates } from './squadrons.fixtures';
import { MemberList } from './member-list';

const meta = {
  title: 'Organisms/MemberList',
  component: MemberList,
  args: { squadron: sailing, blueprint: blueprints[0], templates, crewLines: new Map() },
} satisfies Meta<typeof MemberList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sailing: Story = {};
export const JustFormed: Story = { args: { squadron: forming, crewLines } };
export const FormingOpenedLater: Story = { args: { squadron: forming } };
export const NoMembers: Story = { args: { squadron: { ...sailing, members: [] } } };
