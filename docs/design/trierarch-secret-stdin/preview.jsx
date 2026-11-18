// Documentation-only Storybook harness. Copy beside the dialog stories to render.
import { JOINED } from '../../../../lib/fixtures/machines.fixtures';
import { JoinMachineDialog } from './join-machine-dialog';
import { NewSetupLineDialog } from './new-setup-line-dialog';

export default { title: 'Mockups/SecretStdin', parameters: { layout: 'fullscreen' } };
const before = 'curl -fsSL https://raw.githubusercontent.com/ThomasHendrickx/aeolus-fleet-trierarch/main/install.sh | sh -s -- --fleet-url https://fleet.example.com --ship-id shp_01j9k2t4qzr3a9w6m2v5n7trnw --secret aeolus_sk_v1_example';
const after = "bash <(curl -fsSL https://raw.githubusercontent.com/ThomasHendrickx/aeolus-fleet-trierarch/main/install.sh) --fleet-url https://fleet.example.com --ship-id shp_01j9k2t4qzr3a9w6m2v5n7trnw --secret-stdin <<< 'aeolus_sk_v1_example'";
const noop = () => {};
function join(line, complete = false) {
  const options = " --harnesses claude-code,codex --unattended claude-code --repositories '~/code/web,~/code/api,git@github.com:acme/docs.git'";
  // Redirection stays at the end, after every setup option.
  const setupLine = complete ? (line === after ? after.replace(' --secret-stdin', options + ' --secret-stdin') : before + options) : line;
  return <JoinMachineDialog takenNames={[]} isOpen onOpenChange={noop} isPending={false} onSubmit={noop} joined={{...JOINED, setupLine}} joinedInput={complete ? {name: JOINED.name, harnesses: ['claude-code', 'codex'], unattended: ['claude-code'], repositories: {kind: 'list', entries: ['~/code/web', '~/code/api', 'git@github.com:acme/docs.git']}} : undefined} />;
}
function renewed(line) { return <NewSetupLineDialog name={JOINED.name} isOpen onOpenChange={noop} isPending={false} onConfirm={noop} setupLine={line} />; }
export const JoinBefore = { render: () => join(before) };
export const JoinAfter = { render: () => join(after) };
export const CompleteBefore = { render: () => join(before, true) };
export const CompleteAfter = { render: () => join(after, true) };
export const RenewBefore = { render: () => renewed(before) };
export const RenewAfter = { render: () => renewed(after) };
