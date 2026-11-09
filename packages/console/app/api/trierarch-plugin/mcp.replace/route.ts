import { forwardMcpCall } from '../../../../lib/trierarch-plugin-mcp';

export const dynamic = 'force-dynamic';

/** Replaces the fleet's MCP configuration in the trierarch plugin, for a manager with no page (lib/trierarch-plugin-mcp.ts). */
export async function POST(request: Request): Promise<Response> {
  return forwardMcpCall(request, { procedure: 'mcp.replace', environment: process.env });
}
