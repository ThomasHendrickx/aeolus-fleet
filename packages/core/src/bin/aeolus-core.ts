#!/usr/bin/env node
/**
 * `aeolus-core <command>`: what an operator runs on the server, installed
 * from npm. Every setting comes from environment variables (see the README).
 */
import { readFile } from 'node:fs/promises';

import { fleetInit } from '../adapters/cli/fleet-init.js';
import { fleetRecoverKeys } from '../adapters/cli/fleet-recover-keys.js';
import { companyKeyVaultFor } from '../adapters/kms/company-key-vault.js';
import { migrate } from '../adapters/cli/migrate.js';
import { operatorResetPassword } from '../adapters/cli/operator-reset-password.js';
import { runAtTerminal, runCommand } from '../adapters/cli/run.js';
import { signIn } from '../adapters/cli/sign-in.js';
import { describeFailure } from '../adapters/prisma/failure-log.js';
import { migrateDatabase, MigrationError } from '../adapters/prisma/migrate.js';
import { ConfigError } from '../config.js';
import { start } from '../start.js';

const USAGE = 'Usage: aeolus-core start | migrate | fleet:init --name "<fleet name>" | sign-in | operator:reset-password | fleet:recover-keys --identity <file> --company-key <ARN>';

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'start':
    // Serves until a signal ends the process.
    try {
      await start();
    } catch (error) {
      process.stderr.write(
        `${error instanceof ConfigError || error instanceof MigrationError ? error.message : describeFailure(error)}\n`,
      );
      process.exit(1);
    }
    break;
  case 'migrate':
    await runAtTerminal((io) => migrate({ environment: process.env, migrateDatabase, io }));
    break;
  case 'fleet:init':
    await runCommand(args, ({ useCases, consoleOrigin, io }) =>
      fleetInit(args, { initialiseFleet: useCases.initialiseFleet, issueSignInLink: useCases.issueSignInLink, listFleets: useCases.listFleets, consoleOrigin, io }),
    );
    break;
  case 'sign-in':
    await runCommand(args, ({ useCases, consoleOrigin, io }) =>
      signIn(args, { listFleets: useCases.listFleets, issueSignInLink: useCases.issueSignInLink, consoleOrigin, io }),
    );
    break;
  case 'operator:reset-password':
    await runCommand(args, ({ useCases, io }) =>
      operatorResetPassword(args, {
        listFleets: useCases.listFleets,
        resetOperatorPassword: useCases.resetOperatorPassword,
        io,
      }),
    );
    break;
  case 'fleet:recover-keys':
    // Runs on the company's own computer: it reaches the fleet over its API, never its database.
    await runAtTerminal((io) =>
      fleetRecoverKeys(args, { environment: process.env, fetch, readFile: (path) => readFile(path, 'utf8'), vaultFor: (companyKey) => companyKeyVaultFor(companyKey, process.env), io }),
    );
    break;
  case undefined:
  default:
    process.stderr.write(`${USAGE}\n`);
    process.exit(2);
}
