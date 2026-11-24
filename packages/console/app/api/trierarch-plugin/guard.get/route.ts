import { forwardMcpCall } from '../../../../lib/trierarch-plugin-mcp';

export const dynamic = 'force-dynamic';

/** Offered rule sets and the floor, through the same authenticated console door as MCP configuration. */
export async function GET(request: Request): Promise<Response> {
  return forwardMcpCall(request, { procedure: 'guard.get', environment: process.env });
}
