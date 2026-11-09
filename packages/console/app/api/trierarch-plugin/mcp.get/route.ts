import { forwardMcpCall } from '../../../../lib/trierarch-plugin-mcp';

export const dynamic = 'force-dynamic';

/** The fleet's MCP configuration from the trierarch plugin, for a manager with no page (lib/trierarch-plugin-mcp.ts). */
export async function GET(request: Request): Promise<Response> {
  return forwardMcpCall(request, { procedure: 'mcp.get', environment: process.env });
}
