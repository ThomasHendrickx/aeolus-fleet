import { ConfigError, loadConfig } from '../../config.js';
import { createUseCases, type UseCases } from '../../wiring.js';
import { createPrismaClient } from '../prisma/client.js';
import { describeDatabaseCodes, failureForLog } from '../prisma/failure-log.js';
import type { CommandIo, ExitCode } from './io.js';
import { terminalIo } from './terminal.js';

/** Runs a server command against the configured database and exits with its code. */
export async function runCommand(
  command: (run: { args: string[]; useCases: UseCases; io: CommandIo }) => Promise<ExitCode>,
): Promise<never> {
  const io = terminalIo({ input: process.stdin, output: process.stdout, errors: process.stderr });
  let code: number;
  try {
    const config = loadConfig(process.env);
    const prisma = createPrismaClient(config.databaseUrl);
    try {
      const useCases = createUseCases({ prisma, fleetUrl: config.publicUrl });
      code = await command({ args: process.argv.slice(2), useCases, io });
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    io.err(error instanceof ConfigError ? error.message : describeFailure(error));
    code = 1;
  } finally {
    io.close();
  }
  process.exit(code);
}

/** A failure for the operator's terminal: a database error by its codes, since its message may quote what was typed. */
function describeFailure(error: unknown): string {
  const failure = failureForLog(error);
  return 'database' in failure ? describeDatabaseCodes(failure.database) : String(error);
}
