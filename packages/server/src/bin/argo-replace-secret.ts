import { replaceArgoSecret } from '../adapters/cli/replace-argo-secret.js';
import { runCommand } from '../adapters/cli/run.js';

await runCommand(({ args, useCases, io }) =>
  replaceArgoSecret(args, {
    listFleets: useCases.listFleets,
    replaceOperatorSecret: useCases.replaceOperatorSecret,
    io,
  }),
);
