import { z } from 'zod';

/** The harnesses a machine can join with: the one source of the union the console writes. */
export const JOIN_HARNESSES = ['claude-code', 'codex', 'copilot'] as const;
export type JoinHarness = (typeof JOIN_HARNESSES)[number];

const harnessSchema = z.enum(JOIN_HARNESSES);

/** The trierarch plugin's join options (join-machine design, decision 12), parsed where the browser's input enters the server. The plugin alone builds the setup line. */
export const joinMachineInputSchema = z.object({
  name: z.string().min(1),
  harnesses: z.array(harnessSchema).optional(),
  unattended: z.array(harnessSchema).optional(),
  repositories: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('list'), entries: z.array(z.string()) }),
      z.object({ kind: z.literal('folder'), path: z.string() }),
      z.object({ kind: z.literal('none') }),
    ])
    .optional(),
});

export type JoinMachineInput = z.infer<typeof joinMachineInputSchema>;
