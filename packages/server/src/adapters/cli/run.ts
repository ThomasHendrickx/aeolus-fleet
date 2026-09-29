import { ConfigError, loadConfig } from '../../config.js';
import { createUseCases, type UseCases } from '../../wiring.js';
import { createPrismaClient } from '../prisma/client.js';
import type { CommandIo, ExitCode } from './io.js';

const io: CommandIo = {
  out: (text) => {
    process.stdout.write(`${text}\n`);
  },
  err: (text) => {
    process.stderr.write(`${text}\n`);
  },
};

/** Runs a server command against the configured database and exits with its code. */
export async function runCommand(
  command: (args: string[], useCases: UseCases, io: CommandIo) => Promise<ExitCode>,
): Promise<never> {
  let code: number;
  try {
    const config = loadConfig(process.env);
    const prisma = createPrismaClient(config.databaseUrl);
    try {
      code = await command(process.argv.slice(2), createUseCases({ prisma }), io);
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    io.err(error instanceof ConfigError ? error.message : String(error));
    code = 1;
  }
  process.exit(code);
}
