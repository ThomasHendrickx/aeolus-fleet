import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { activeShipCount, labelRowsOf } from '../../lib/labels';
import { LabelsTable } from './labels-table';
import { labelContext, labelledFleet } from './labels.fixtures';

const FLEET = labelledFleet();
const CONTEXT = labelContext(FLEET);

const meta = {
  title: 'Organisms/LabelsTable',
  component: LabelsTable,
  args: {
    rows: labelRowsOf(CONTEXT),
    shipTotal: activeShipCount(CONTEXT),
    onRetry: fn(),
    onDefine: fn(),
    onChangeValues: fn(),
    onDelete: fn(),
  },
} satisfies Meta<typeof LabelsTable>;

export default meta;
type Story = StoryObj<typeof meta>;

/** argo's labels, the trierarch plugin's and squadrons' (canvas LbList): each value opens the overview filtered by it; yours have a menu. */
export const Default: Story = {};
/** The viewer, who defines nothing (canvas LbViewerList): every label read-only, argo's marked. */
export const Viewer: Story = {
  args: { rows: labelRowsOf(labelContext(FLEET, false)), onDefine: undefined, onChangeValues: undefined, onDelete: undefined },
};
/** No labels yet (canvas LbListEmpty), with Define a label. */
export const Empty: Story = { args: { rows: [] } };
/** No labels, for a viewer: nothing to do from here. */
export const EmptyViewer: Story = { args: { rows: [], onDefine: undefined } };
export const Loading: Story = { args: { rows: undefined } };
/** The fleet server didn't answer (canvas LbListError). */
export const Error: Story = { args: { rows: undefined, error: 'Request timed out after 10 s' } };
/** On phone (canvas LbMList): a card per label. */
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
