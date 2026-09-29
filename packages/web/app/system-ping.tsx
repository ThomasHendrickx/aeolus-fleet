'use client';

import { useQuery } from '@tanstack/react-query';

import { useTRPC } from '../lib/trpc';

/** Calls system.ping from the browser: one request to the database and back. */
export function SystemPing() {
  const trpc = useTRPC();
  const ping = useQuery(trpc.system.ping.queryOptions());

  if (ping.isPending) {
    return <p>Pinging the server...</p>;
  }

  if (ping.isError) {
    return <p role="alert">Ping failed: {ping.error.message}</p>;
  }

  return (
    <dl>
      <dt>Server time</dt>
      <dd>
        <time dateTime={ping.data.serverTime}>{new Date(ping.data.serverTime).toLocaleString()}</time>
      </dd>
      <dt>Fleets</dt>
      <dd>{ping.data.fleetCount}</dd>
    </dl>
  );
}
