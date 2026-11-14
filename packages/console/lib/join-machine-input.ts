/** The trierarch plugin's join options (join-machine design, decision 12). The plugin alone builds the setup line. */
export interface JoinMachineInput {
  name: string;
  harnesses?: readonly ('claude-code' | 'codex' | 'copilot')[];
  unattended?: readonly ('claude-code' | 'codex' | 'copilot')[];
  repositories?: { kind: 'list'; entries: readonly string[] } | { kind: 'folder'; path: string } | { kind: 'none' };
}
