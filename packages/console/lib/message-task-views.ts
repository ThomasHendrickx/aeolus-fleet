/** Other-fleet message tasks, authorized on the console server with the viewer's own token (monitoring 4.2). */
import { idSchema, messageTaskAccessOutputSchema, type ReportTask } from '@aeolus-fleet/common';
import { z } from 'zod';

import { cookieValueOf, exchangeSignIn, fleetsOf, pagasaeFrom, SHARED_SIGN_IN_COOKIE } from './pagasae';
import { serverInternalUrlFrom } from './server-url';

interface TaskViewer {
  environment: Readonly<Record<string, string | undefined>>;
  cookieHeader: string;
  viewerFleetId?: string;
  fetchImplementation?: typeof fetch;
}

export async function messageTaskViews(tasks: readonly (ReportTask | null)[], input: TaskViewer): Promise<(ReportTask | null)[]> {
  const { environment, cookieHeader, viewerFleetId, fetchImplementation = fetch } = input;
  const pagasae = pagasaeFrom(environment);
  const signIn = cookieValueOf(cookieHeader, SHARED_SIGN_IN_COOKIE);
  if (pagasae === undefined || signIn === undefined || viewerFleetId === undefined) {
    return [...tasks];
  }
  const remote = tasks.filter((task) => task?.kind === 'message' && task.fleetId !== viewerFleetId);
  if (remote.length === 0) {
    return [...tasks];
  }
  const at = { pagasae, fetchImplementation };
  const fleets = await fleetsOf(at, signIn);
  if (!Array.isArray(fleets)) {
    return [...tasks];
  }
  const views = new Map<string, ReportTask>();
  await Promise.all(fleets.filter((fleet) => remote.some((task) => task?.fleetId === fleet.id)).map(async (fleet) => {
    const references = remote.flatMap((task) => {
      const id = idSchema('message').safeParse(task?.messageId);
      return task?.fleetId === fleet.id && id.success ? [{ task, id: id.data }] : [];
    });
    const exchanged = await exchangeSignIn(at, { signIn, fleetId: fleet.id });
    if (exchanged.kind !== 'token') {
      return;
    }
    try {
      const url = new URL(`${serverInternalUrlFrom(environment)}/trpc/fleet.messageTaskAccess`);
      url.searchParams.set('input', JSON.stringify({ messageIds: [...new Set(references.map(({ id }) => id))] }));
      const response = await fetchImplementation(url.toString(), { headers: { authorization: `Bearer ${exchanged.token}` }, cache: 'no-store', signal: AbortSignal.timeout(3000) });
      const answer = z.object({ result: z.object({ data: messageTaskAccessOutputSchema }) }).safeParse(await response.json());
      if (!response.ok || !answer.success) {
        return;
      }
      const access = new Map(answer.data.result.data.items.map((item) => [item.messageId, item.canOpen]));
      for (const { task, id } of references) {
        views.set(`${fleet.id}/${id}`, { ...task, fleetName: fleet.name, canOpen: access.get(id) === true });
      }
    } catch {
      // A failed read offers no link and discloses no other fleet's name.
    }
  }));
  return tasks.map((task) => task?.kind === 'message' && typeof task.fleetId === 'string' && typeof task.messageId === 'string' ? views.get(`${task.fleetId}/${task.messageId}`) ?? task : task);
}
