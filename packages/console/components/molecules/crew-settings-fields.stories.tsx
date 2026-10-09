import { FIRST_PROMPT_MAX_BYTES } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';

import { defaultValues, type HarnessOffer } from '../../lib/crew-settings-form';
import { CrewSettingsFields } from './crew-settings-fields';

const OFFERS: HarnessOffer[] = [
  { harness: 'claude-code', repositories: ['aeolus-fleet', 'hemma'], folders: ['notes'], options: [{ name: 'model', values: ['claude-opus-5-5', 'claude-sonnet-5'], defaultValue: 'claude-opus-5-5' }] },
  { harness: 'codex', repositories: ['aeolus-fleet'], folders: [], options: [] },
];

/** The fields, holding their own values, as a form does. */
function Fields(props: { squadrons?: readonly string[]; refusal?: { field: string; reason: string } }) {
  const [values, setValues] = useState(() => defaultValues(OFFERS));
  return <CrewSettingsFields offers={OFFERS} values={values} onChange={setValues} firstPromptMaxBytes={FIRST_PROMPT_MAX_BYTES} {...props} />;
}

const meta = {
  title: 'Molecules/CrewSettingsFields',
  component: Fields,
} satisfies Meta<typeof Fields>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = {};
export const WithSquadrons: Story = { args: { squadrons: ['hemma-feature-63p5sx'] } };
export const WorkspaceRefused: Story = { args: { refusal: { field: 'workspace', reason: 'no trierarch offering claude-code has repository aeolus-fleet' } } };
