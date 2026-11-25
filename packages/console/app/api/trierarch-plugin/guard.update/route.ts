import { forwardMcpCall } from '../../../../lib/trierarch-plugin-mcp';

export const dynamic = 'force-dynamic';

/** The trierarch plugin checks the operator's guard scope and Origin. */
export async function POST(request: Request): Promise<Response> {
  return forwardMcpCall(request, { procedure: 'guard.update', environment: process.env });
}
