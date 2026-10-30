import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { blueprints, crewLines, forming, memberShips, NOW, sailing, templates } from '../../../../lib/fixtures/squadrons.fixtures';
import { MemberList } from './member-list';
import { VIEWER_FLEET_ID } from '../../../../lib/fixtures/report.fixtures';

const meta = {
  title: 'Organisms/MemberList',
  component: MemberList,
  args: { squadron: sailing, blueprint: blueprints[0], templates, crewLines: new Map(), ships: memberShips, now: NOW, viewerFleetId: VIEWER_FLEET_ID },
} satisfies Meta<typeof MemberList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sailing: Story = {};
export const JustFormed: Story = { args: { squadron: forming, crewLines } };
export const FormingOpenedLater: Story = { args: { squadron: forming } };
export const NoMembers: Story = { args: { squadron: { ...sailing, members: [] } } };
