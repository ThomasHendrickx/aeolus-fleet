import { ConfigError, loadConfig } from '../../config.js';
import { createUseCases, type UseCases } from '../../wiring.js';
import { createPrismaClient } from '../prisma/client.js';
import { describeFailure } from '../prisma/failure-log.js';
import { MigrationError } from '../prisma/migrate.js';
import type { CommandIo, ExitCode } from './io.js';
import { terminalIo } from './terminal.js';

/**
 * Runs a server command at the operator's terminal and exits with its code.
 * A bad configuration or a failed migration is told in its own words; any
 * other failure as `describeFailure` tells it, a database error by its codes.
 */
export async function runAtTerminal(command: (io: CommandIo) => Promise<ExitCode>): Promise<never> {
  const io = terminalIo({ input: process.stdin, output: process.stdout, errors: process.stderr });
  let code: number;
  try {
    code = await command(io);
  } catch (error) {
    io.err(error instanceof ConfigError || error instanceof MigrationError ? error.message : describeFailure(error));
    code = 1;
  } finally {
    io.close();
  }
  process.exit(code);
}

/** Runs a server command against the configured database and exits with its code. */
export function runCommand(
  args: string[],
  command: (run: { args: string[]; useCases: UseCases; io: CommandIo }) => Promise<ExitCode>,
): Promise<never> {
  return runAtTerminal(async (io) => {
    const config = loadConfig(process.env);
    const prisma = createPrismaClient(config.databaseUrl);
    try {
      return await command({ args, useCases: createUseCases({ prisma, fleetUrl: config.publicUrl }), io });
    } finally {
      await prisma.$disconnect();
    }
  });
}
