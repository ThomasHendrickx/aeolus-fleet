import { sessionOf } from '../../../../lib/console-gate';
import { answerConsoleRead } from '../../../../lib/console-read';
import { CONSOLE_READS } from '../../../../lib/console-reads';
import { serverInternalUrlFrom } from '../../../../lib/server-url';

// Every read asks the plugin afresh with the operator's session: nothing here is cached.
export const dynamic = 'force-dynamic';

/** A console read by name (lib/console-reads.ts), for a live session only: its answer, a refusal included, as JSON. */
export async function GET(request: Request, { params }: RouteContext<'/api/reads/[read]'>): Promise<Response> {
  return answerConsoleRead(request, {
    name: (await params).read,
    reads: CONSOLE_READS,
    sessionOf: (asking) => sessionOf(asking, { serverUrl: serverInternalUrlFrom(process.env) }),
  });
}
