import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { CREWED_SHIP, NOW } from './ship-page.fixtures';
import { SilentMembers } from './silent-members';
import { forming } from './squadrons.fixtures';

const tester = forming.members[3];

const meta = {
  title: 'Organisms/SilentMembers',
  component: SilentMembers,
  args: {
    members: tester
      ? [{ squadronId: forming.id, member: { ...tester, health: 'silent', checkInMinutes: 10, crew: { status: 'crewed', lastSeenAt: '2026-09-28T13:19:00Z', crewedSince: null } } }]
      : [],
    ships: new Map([[tester?.shipId ?? '', { ...CREWED_SHIP, report: { state: 'blocked', note: 'e2e needs a staging slot', reportedAt: '2026-09-28T13:19:00Z' } }]]),
    now: NOW,
  },
} satisfies Meta<typeof SilentMembers>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneSilent: Story = {};
