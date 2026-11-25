import { trierarchNameSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

/** Metadata only, projected on the console server as the MCP configuration is. */
const configurationSchema = z.object({
  version: z.int().nonnegative(),
  repositories: z.array(z.object({
    repository: z.string(), folder: z.string(), access: z.enum(['public', 'private']), readCommit: z.string().nullable(),
  })),
  sets: z.array(z.object({
    name: trierarchNameSchema, repository: z.string(), commit: z.string(), file: z.string(), rulesCount: z.int().nonnegative(),
  })),
  errors: z.array(z.object({ repository: z.string(), file: z.string().optional(), reason: z.string() })),
  conflicts: z.array(z.object({ name: trierarchNameSchema, repositories: z.array(z.string()) })),
  floor: z.array(trierarchNameSchema),
});

export type GuardConfiguration = z.infer<typeof configurationSchema>;

const catalogueAnswerSchema = z.object({ result: z.object({ data: configurationSchema }) });

export const guardAnswerSchemas = {
  'guard.get': catalogueAnswerSchema,
  'guard.update': catalogueAnswerSchema,
  'guard.replace': z.object({ result: z.object({ data: z.object({ version: z.int().positive() }) }) }),
};
