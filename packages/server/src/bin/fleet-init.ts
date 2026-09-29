import { fleetInit } from '../adapters/cli/fleet-init.js';
import { runCommand } from '../adapters/cli/run.js';

await runCommand(({ args, useCases, io }) => fleetInit(args, { initialiseFleet: useCases.initialiseFleet, io }));
