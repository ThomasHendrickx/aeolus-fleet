import type { JoinMachineInput } from '../../../lib/join-machine-input';

/** Describe the submitted options without parsing or building the plugin's setup line. */
export function joinMachineDescription(input: JoinMachineInput | undefined): string {
  const names = input?.harnesses?.map((harness) => ({ 'claude-code': 'Claude Code', codex: 'Codex', copilot: 'Copilot' })[harness]) ?? [];
  const harnesses = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(names);
  const plugin = harnesses === '' ? 'the aeolus-fleet plugin for each harness you pick' : `the aeolus-fleet plugin for ${harnesses}`;
  const repositories = input?.repositories;
  const repositoryAction = repositories === undefined ? undefined : repositories.kind === 'none' ? 'adds no repositories' : repositories.kind === 'folder' ? `adds every repository directly in ${repositories.path}` : `adds ${repositories.entries.length} ${repositories.entries.length === 1 ? 'repository' : 'repositories'}`;
  const actions = repositoryAction === undefined
    ? `the trierarch, ${plugin}, and starts the trierarch`
    : `the trierarch and ${plugin}, ${repositoryAction}, and starts the trierarch`;
  const asks = [harnesses === '' ? 'the harnesses' : undefined, repositories === undefined ? 'the repositories' : undefined].filter((part) => part !== undefined);
  const question = asks.length === 0 ? 'It asks nothing.' : `It asks on the machine for ${asks.join(' and ')}.`;
  return `Run this line in a terminal on the machine. It installs ${actions}. ${question} It ends with a report of how it went.`;
}
