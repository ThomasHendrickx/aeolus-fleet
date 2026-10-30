/** Report reads pass through the console server so other fleets use the viewer's shared sign-in. No response is cached. */
import { consoleSessionOutputSchema, fleetListOutputSchema, listedShipOutputSchema, shipOutputSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import { messageTaskViews } from './message-task-views';
import { cookieValueOf, pagasaeFrom, SHARED_SIGN_IN_COOKIE } from './pagasae';
import { sessionCookieOf } from './plugin-call';
import { serverInternalUrlFrom } from './server-url';

const PROCEDURES = ['fleet.list', 'fleet.listedShip', 'fleet.ship'];
const answerSchema = z.object({ result: z.object({ data: z.unknown() }) });

export async function answerReportRead(request: Request, input: { procedure: string; environment: Readonly<Record<string, string | undefined>>; fetchImplementation?: typeof fetch }): Promise<Response> {
  const { procedure, environment, fetchImplementation = fetch } = input;
  if (!PROCEDURES.includes(procedure)) {
    return new Response(null, { status: 404 });
  }
  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookie = sessionCookieOf(cookieHeader);
  const server = serverInternalUrlFrom(environment);
  const url = new URL(`${server}/trpc/${procedure}`);
  url.search = new URL(request.url).search;
  const response = await fetchImplementation(url.toString(), { headers: { cookie }, cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  if (!response.ok || pagasaeFrom(environment) === undefined || cookieValueOf(cookieHeader, SHARED_SIGN_IN_COOKIE) === undefined) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  const raw: unknown = await response.json();
  const answer = answerSchema.safeParse(raw);
  if (!answer.success) {
    return Response.json(raw, { status: response.status, headers });
  }
  const parsed = z.union([fleetListOutputSchema, shipOutputSchema, listedShipOutputSchema]).safeParse(answer.data.result.data);
  if (!parsed.success) {
    return Response.json(raw, { status: response.status, headers });
  }
  const data = parsed.data;
  const ships = 'items' in data ? data.items : [data];
  const tasks = ships.map((ship) => 'report' in ship && ship.report?.task ? { ...ship.report.task, canOpen: ship.report.taskView?.canOpen === true, fleetName: ship.report.taskView?.fleetName ?? null } : null);
  if (!tasks.some((task) => task?.kind === 'message')) {
    return Response.json(raw, { status: response.status, headers });
  }
  const session = await fetchImplementation(`${server}/trpc/console.session`, { headers: { cookie }, cache: 'no-store', signal: AbortSignal.timeout(3000) }).catch(() => undefined);
  const signedIn = z.object({ result: z.object({ data: consoleSessionOutputSchema }) }).safeParse(await session?.json().catch(() => undefined));
  const views = await messageTaskViews(tasks, { environment, cookieHeader, fetchImplementation, viewerFleetId: signedIn.success ? signedIn.data.result.data.fleetId : undefined });
  const enriched = ships.map((ship, index) => 'report' in ship && ship.report ? { ...ship, report: { ...ship.report, taskView: { canOpen: views[index]?.canOpen === true, fleetName: typeof views[index]?.fleetName === 'string' ? views[index].fleetName : null } } } : ship);
  const result = 'items' in data ? { ...data, items: enriched } : enriched[0];
  return Response.json({ result: { data: result } }, { status: response.status, headers });
}
