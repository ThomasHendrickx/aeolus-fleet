import type { CheckedNetworkRulesFile } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';

import { ImportNetworkRulesDialog } from './import-network-rules-dialog';

const SHIPS = [
  { id: 'shp_01m3tb1zhjs6kthtcs2zvksacv', name: 'argo', isOperator: true },
  { id: 'shp_01m5m1s80kqtcvby5jgb4ab4d6', name: 'crm-app', isOperator: false },
  { id: 'shp_01m5m1yr8a8xze0vaw2k9e6s5d', name: 'thomas-person', isOperator: false },
] as const;

const FILE: CheckedNetworkRulesFile['file'] = {
  format: 'aeolus.network-rules',
  version: 1,
  exportedAt: '2026-10-23T14:02:11.000Z',
  fleet: { id: 'flt_01m3tb1zgr5h2ffee12xnch8sv', name: 'staging' },
  rulesVersion: 42,
  labels: [
    { key: 'crm', values: ['app', 'user'], definer: 'argo' },
    { key: 'os', values: ['linux'], definer: 'argo' },
  ],
  rules: [
    { verb: 'send', from: [{ label: 'crm', value: 'user' }], to: [{ label: 'crm', value: 'app' }] },
    { verb: 'manage', from: [{ owner: 'thomas' }], to: [{ label: 'os', value: '*' }] },
  ],
};

const CLEAN: CheckedNetworkRulesFile = { file: FILE, newLabels: ['os'], differences: [] };

const DIFFERENT: CheckedNetworkRulesFile = {
  file: FILE,
  newLabels: ['os'],
  differences: [
    { kind: 'definer', key: 'crm', fileDefiner: 'argo', fleetDefiner: 'crm-app', ways: ['useExisting', 'dropRules'] },
    { kind: 'ship', name: 'thomas', ways: ['pickShip', 'dropRules'] },
  ],
};

const meta = {
  title: 'Organisms/ImportNetworkRulesDialog',
  component: ImportNetworkRulesDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    isOpen: true,
    onOpenChange: fn(),
    isChecking: false,
    onCheck: fn(),
    onFileChange: fn(),
    ships: SHIPS,
    isImporting: false,
    onImport: fn(),
  },
  decorators: [
    (Story) => (
      <div className="min-h-200">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ImportNetworkRulesDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

async function dialog() {
  return waitFor(async () => {
    const shown = await screen.findByTestId('network-import-dialog');
    await expect(shown).toBeVisible();
    return shown;
  });
}

/** Step 1: attach or paste; Check waits for a file. */
export const AttachOrPaste: Story = {
  play: async () => {
    await dialog();
    await expect(screen.getByTestId('network-import-check')).toBeDisabled();
  },
};
/** A pasted file goes to the fleet to check, as it is. */
export const Pasting: Story = {
  play: async ({ args }) => {
    await dialog();
    await userEvent.click(screen.getByTestId('network-import-paste'));
    await userEvent.paste('{"format":"aeolus.network-rules"}');
    await userEvent.click(screen.getByTestId('network-import-check'));
    await expect(args.onCheck).toHaveBeenCalledWith('{"format":"aeolus.network-rules"}');
  },
};
/** Step 2 pending: the fleet checks the file. */
export const Checking: Story = {
  args: { isChecking: true },
  play: async () => {
    await dialog();
    await expect(screen.getByTestId('network-import-check')).toHaveTextContent('Checking…');
  },
};
/** The check failed: each break is named, the file kept. */
export const CheckFailed: Story = {
  args: { checkError: 'The file breaks: rule 1: os is a label the file does not hold' },
};
/** Step 3 with no difference: the checkmark, the labels import defines for argo, every rule. */
export const Checked: Story = {
  args: { checked: CLEAN },
  play: async () => {
    await dialog();
    await expect(screen.getByTestId('network-import-checked')).toHaveTextContent('The file checks: 2 rules and 2 labels, from staging at rules version 42');
    await expect(screen.getByTestId('network-import-rules')).toHaveTextContent('send: crm=user → crm=app');
    await expect(screen.getByTestId('network-import-open-confirm')).toBeEnabled();
  },
};
/** Differences on top: Import waits until every one is resolved. */
export const WithDifferences: Story = {
  args: { checked: DIFFERENT },
  play: async () => {
    await dialog();
    await expect(screen.getAllByTestId('network-import-difference')).toHaveLength(2);
    await expect(screen.getByTestId('network-import-open-confirm')).toBeDisabled();
  },
};
/** Resolving every difference, then confirming, imports with the resolutions. */
export const Importing: Story = {
  args: { checked: DIFFERENT },
  play: async ({ args }) => {
    await dialog();
    const [useExisting] = screen.getAllByTestId('network-import-way-useExisting');
    const dropRules = screen.getAllByTestId('network-import-way-dropRules')[1];
    if (useExisting === undefined || dropRules === undefined) {
      throw new Error('the ways are not shown');
    }
    await userEvent.click(useExisting);
    await userEvent.click(dropRules);
    await userEvent.click(screen.getByTestId('network-import-open-confirm'));
    await expect(screen.getByTestId('network-import-consequences')).toHaveTextContent('os is defined for argo.');
    await userEvent.click(screen.getByTestId('network-import-confirm'));
    await expect(args.onImport).toHaveBeenCalledWith({
      file: '',
      resolutions: [
        { kind: 'definer', key: 'crm', way: 'useExisting' },
        { kind: 'ship', name: 'thomas', way: 'dropRules' },
      ],
    });
  },
};
/** The import pending: the confirm shows it works and nothing else runs. */
export const ImportPending: Story = {
  args: { checked: CLEAN, isImporting: true },
  play: async () => {
    await dialog();
    await expect(screen.getByTestId('network-import-open-confirm')).toBeDisabled();
  },
};
/** The import failed: the reason, nothing written, and a way to check again. */
export const ImportFailed: Story = {
  args: { checked: CLEAN, importError: 'The fleet differs from the file, unresolved: the ship thomas. Check the file again and resolve every difference' },
  play: async () => {
    await dialog();
    await userEvent.click(screen.getByTestId('network-import-open-confirm'));
    await expect(screen.getByText('Couldn’t import the file')).toBeVisible();
  },
};
