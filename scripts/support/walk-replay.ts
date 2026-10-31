import { SHIP_CALLS } from '../../packages/core/src/adapters/trpc/ship-contract.js';
import { apiSteps, argumentProblems, walkSection } from './walk.ts';

/** What the Walk's API steps get wrong against the ship contract this commit serves: an unknown call, arguments that do not fit. */
export function replayProblems(body: string): string[] {
  const section = walkSection(body);
  if (section === undefined) {
    return [];
  }
  return apiSteps(section).flatMap((step) => {
    const call = SHIP_CALLS.find(({ name }) => name === step.tool);
    if (call === undefined) {
      return [`Walk step ${String(step.number)}: \`${step.tool}\` is not a call of the ship contract. Mark the step "staging only" if it is not one.`];
    }
    if (step.input === undefined) {
      return [`Walk step ${String(step.number)}: the arguments of \`${step.tool}\` are not a JSON object: ${step.rawInput}`];
    }
    const schema = call.input?.schema ?? { type: 'object', properties: {}, required: [] };
    return argumentProblems(step.input, schema).map((problem) => `Walk step ${String(step.number)}: \`${step.tool}\` ${problem}`);
  });
}
