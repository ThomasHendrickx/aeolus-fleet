import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { ENTRIES, NOW, TIDE_TABLES } from '../../../../lib/fixtures/inbox.fixtures';
import { isOpenEntry } from '../../../../lib/inbox-entry';
import { inboxViewOf, waitingOf } from '../../services/inbox-view';
import { InboxList } from './inbox-list';

const meta = {
  title: 'Organisms/InboxList',
  component: InboxList,
  args: {
    view: inboxViewOf(ENTRIES.filter(isOpenEntry)),
    segment: 'open',
    onSegmentChange: fn(),
    counts: { open: ENTRIES.filter(isOpenEntry).length },
    waiting: waitingOf(ENTRIES, NOW),
    selectedId: TIDE_TABLES.deliveryId,
    onSelect: fn(),
    isPluginGroupExpanded: false,
    onTogglePluginGroup: fn(),
    onPluginGroupDone: fn(),
    now: NOW,
  },
  decorators: [(Story) => <div className="max-w-sm">{Story()}</div>],
} satisfies Meta<typeof InboxList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Questions with how long the oldest waits, Messages, and the plugin ships folded. */
export const Open: Story = {};

export const Done: Story = { args: { view: inboxViewOf(ENTRIES.filter((entry) => !isOpenEntry(entry))), segment: 'done', selectedId: undefined } };

export const CountsUnknown: Story = { args: { counts: {} } };
