import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { CREWED_SHIP, NOW } from '../../../../lib/fixtures/ship-page.fixtures';
import { SilentMembers } from './silent-members';
import { forming } from '../../../../lib/fixtures/squadrons.fixtures';
import { VIEWER_FLEET_ID } from '../../../../lib/fixtures/report.fixtures';

const tester = forming.members[3];

const meta = {
  title: 'Organisms/SilentMembers',
  component: SilentMembers,
  args: {
    viewerFleetId: VIEWER_FLEET_ID,
    members: tester
      ? [{ squadronId: forming.id, member: { ...tester, health: 'silent', checkInMinutes: 10, crew: { status: 'crewed', lastSeenAt: '2026-09-28T13:19:00Z', crewedSince: null } } }]
      : [],
    ships: new Map([[tester?.shipId ?? '', { ...CREWED_SHIP, report: { state: 'blocked', note: 'e2e needs a staging slot', task: null, step: null, reportedAt: '2026-09-28T13:19:00Z', reportChangedAt: '2026-09-28T13:19:00Z', detailsVersion: 0 } }]]),
    now: NOW,
  },
} satisfies Meta<typeof SilentMembers>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneSilent: Story = {};
