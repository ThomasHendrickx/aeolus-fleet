import { forwardMcpCall } from '../../../../lib/trierarch-plugin-mcp';

export const dynamic = 'force-dynamic';

/** The plugin authorizes changes with trierarch:guard and the caller's Origin. */
export async function POST(request: Request): Promise<Response> {
  return forwardMcpCall(request, { procedure: 'guard.replace', environment: process.env });
}
