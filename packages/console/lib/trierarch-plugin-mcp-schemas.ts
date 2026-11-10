import { z } from 'zod';

/** The existing plugin answers, parsed on the console server before reaching a browser. */
const serverSchema = z
  .object({
    name: z.string(),
    url: z.string(),
    tools: z.array(z.string()).readonly(),
    credential: z.object({ header: z.string(), secret: z.string() }).readonly().optional(),
  })
  .readonly();
const configurationSchema = z
  .object({
    version: z.int().nonnegative(),
    servers: z.array(serverSchema).readonly(),
    secrets: z.array(z.string()).readonly(),
  })
  .readonly();

export type McpServer = z.infer<typeof serverSchema>;
export type McpConfiguration = z.infer<typeof configurationSchema>;

/** Output projections contain metadata and committed versions, never secret values. */
export const mcpAnswerSchemas = {
  'mcp.get': z.object({ result: z.object({ data: configurationSchema }) }),
  'mcp.replace': z.object({ result: z.object({ data: z.object({ version: z.int().positive() }) }) }),
};
