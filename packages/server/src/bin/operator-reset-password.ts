import { operatorResetPassword } from '../adapters/cli/operator-reset-password.js';
import { runCommand } from '../adapters/cli/run.js';

await runCommand(({ args, useCases, io }) =>
  operatorResetPassword(args, {
    listFleets: useCases.listFleets,
    resetOperatorPassword: useCases.resetOperatorPassword,
    io,
  }),
);
