/**
 * A command on the company's own computer calls the fleet's tRPC API, the one
 * door (decision 0004), as any other client does, over HTTPS, with the
 * credentials the API already takes (decision 0057): a crew token of a ship,
 * an account's token through that ship, or the installation token with the
 * fleet it acts in. It holds no logic of its own.
 */
import { ACCOUNT_TOKEN_HEADER, FLEET_HEADER } from '@aeolus-fleet/common';
import { z } from 'zod';

import { err, ok, type Result } from '../../domain/shared/result.js';
import { INSTALLATION_TOKEN_HEADER } from '../trpc/installation-token.js';

/** The environment variables a command reaches the fleet with. */
export const FLEET_API_VARIABLES = {
  url: 'AEOLUS_URL',
  crewToken: 'AEOLUS_CREW_TOKEN',
  accountToken: 'AEOLUS_ACCOUNT_TOKEN',
  installationToken: 'AEOLUS_INSTALLATION_TOKEN',
  fleet: 'AEOLUS_FLEET',
} as const;

/** The fleet refused the call: the API's code (such as `CONFLICT`) and its message. */
export interface FleetApiRefusal {
  readonly kind: 'refused';
  readonly code: string;
  readonly message: string;
}

export interface FleetApi {
  query<T>(procedure: string, output: z.ZodType<T>): Promise<Result<T, FleetApiRefusal>>;
  mutation<T>(procedure: string, call: { input: unknown; output: z.ZodType<T> }): Promise<Result<T, FleetApiRefusal>>;
}

const answerSchema = z.union([
  z.object({ result: z.object({ data: z.unknown() }) }),
  z.object({ error: z.object({ message: z.string(), data: z.object({ code: z.string() }).optional() }) }),
]);

/** Where the fleet is and the headers that say who calls, from the environment; else what is missing. */
export function fleetApiCredentialsOf(environment: Readonly<Record<string, string | undefined>>): Result<{ url: string; headers: Record<string, string> }, string> {
  const { url, crewToken, accountToken, installationToken, fleet } = FLEET_API_VARIABLES;
  const fleetUrl = environment[url];
  if (fleetUrl === undefined || fleetUrl === '') {
    return err(`Set ${url} to the fleet's address, such as https://fleet.example.com`);
  }
  const headers: Record<string, string> = {};
  const crew = environment[crewToken];
  const account = environment[accountToken];
  const installation = environment[installationToken];
  const actingIn = environment[fleet];
  if (crew !== undefined && crew !== '') {
    headers.authorization = `Bearer ${crew}`;
    if (account !== undefined && account !== '') {
      headers[ACCOUNT_TOKEN_HEADER] = account;
    }
  } else if (installation !== undefined && installation !== '' && actingIn !== undefined && actingIn !== '') {
    headers[INSTALLATION_TOKEN_HEADER] = installation;
    headers[FLEET_HEADER] = actingIn;
  } else {
    return err(`Set ${crewToken} (a ship holding fleet:keys, with ${accountToken} for an account through it), or ${installationToken} with ${fleet} on a self-hosted server`);
  }
  return ok({ url: fleetUrl.replace(/\/+$/, ''), headers });
}

export function createFleetApi(deps: { url: string; headers: Readonly<Record<string, string>>; fetch: typeof fetch }): FleetApi {
  const answered = async <T>(response: Response, output: z.ZodType<T>): Promise<Result<T, FleetApiRefusal>> => {
    const answer = answerSchema.parse(await response.json());
    if ('error' in answer) {
      return err({ kind: 'refused', code: answer.error.data?.code ?? String(response.status), message: answer.error.message });
    }
    return ok(output.parse(answer.result.data));
  };

  return {
    query: async (procedure, output) => answered(await deps.fetch(`${deps.url}/trpc/${procedure}`, { headers: deps.headers }), output),
    mutation: async (procedure, { input, output }) =>
      answered(
        await deps.fetch(`${deps.url}/trpc/${procedure}`, { method: 'POST', headers: { ...deps.headers, 'content-type': 'application/json' }, body: JSON.stringify(input) }),
        output,
      ),
  };
}
