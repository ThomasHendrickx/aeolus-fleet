#!/usr/bin/env node
/**
 * `aeolus-core <command>`: what an operator runs on the server, installed
 * from npm. Every setting comes from environment variables (see the README).
 */
import { fleetInit } from '../adapters/cli/fleet-init.js';
import { migrate } from '../adapters/cli/migrate.js';
import { operatorResetPassword } from '../adapters/cli/operator-reset-password.js';
import { runAtTerminal, runCommand } from '../adapters/cli/run.js';
import { describeFailure } from '../adapters/prisma/failure-log.js';
import { migrateDatabase, MigrationError } from '../adapters/prisma/migrate.js';
import { ConfigError } from '../config.js';
import { start } from '../start.js';

const USAGE = 'Usage: aeolus-core start | migrate | fleet:init --name "<fleet name>" | operator:reset-password';

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
    await runCommand(args, ({ useCases, io }) => fleetInit(args, { initialiseFleet: useCases.initialiseFleet, listFleets: useCases.listFleets, io }));
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
  case undefined:
  default:
    process.stderr.write(`${USAGE}\n`);
    process.exit(2);
}
