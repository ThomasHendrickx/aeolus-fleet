import type { ListedShip } from '@aeolus-fleet/common';

import { fullDateTime } from '../../lib/relative-time';
import { pingLine } from '../../lib/ping';

/**
 * How a ship's last ping stands, under its Last seen: "Pinged 3 min ago, no
 * answer yet", "Answered ping in 4 s", "Received, not answered with pong" or
 * "Ping not answered: undeliverable".
 * Said in words, never by colour alone. Nothing before any ping.
 */
export function PingStatus({
  ping,
  now,
  testId,
}: {
  ping: ListedShip['ping'];
  now: Date;
  /** The test id of the line, by where it shows. */
  testId: string;
}) {
  if (ping === null) {
    return null;
  }
  return (
    <span
      title={`Pinged ${fullDateTime(new Date(ping.sentAt))}`}
      data-testid={testId}
      data-state={ping.state}
      className="text-meta text-muted-foreground tabular-nums"
    >
      {pingLine(ping, now)}
    </span>
  );
}
