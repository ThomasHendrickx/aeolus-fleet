import { readdir, readFile, readlink } from 'node:fs/promises';
import type { Socket } from 'node:net';

import type { ShipId } from '@aeolus-fleet/common';

import { runCommand } from './run-command.js';

/**
 * Who may call a ship's socket (decision 0026): a process of the ship's own
 * session, under its session's root (its pane, or its container), or of the
 * trierarch itself, as its aeolus-push.sh. Anything else is refused, another
 * ship's session among them, and so is a call whose caller does not resolve.
 *
 * On Linux the caller is the peer of the connection: `ss` names the inode of
 * the socket at its other end, and the processes holding that inode are read
 * from /proc, which also finds a process in a container's own network
 * namespace, where `ss` shows nothing. Each must sit under one of the roots.
 * Elsewhere no peer resolves yet, so every call is refused.
 */
export type CallerCheck = (shipId: ShipId, connection: Socket) => Promise<boolean>;

const SOCKET_LINK = /^socket:\[(\d+)\]$/;
/** Deeper than any real process tree: a walk that goes on longer is not trusted. */
const MOST_ANCESTORS = 4096;

/** The descriptor of a connection, which Node keeps on its handle without documenting it. */
function descriptorOf(connection: Socket): number | undefined {
  const handle: unknown = Reflect.get(connection, '_handle');
  const fd: unknown = typeof handle === 'object' && handle !== null ? Reflect.get(handle, 'fd') : undefined;
  return typeof fd === 'number' && fd >= 0 ? fd : undefined;
}

/** The inode of the socket at the other end of this process's socket of that inode, as `ss` lists it: `... <local inode> <peer> <peer inode>`. */
async function peerInodeOf(inode: string, run: typeof runCommand): Promise<string | undefined> {
  const listed = await run('ss', { args: ['-xH'] });
  if (listed.status !== 0) {
    return undefined;
  }
  for (const line of listed.stdout.split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields.at(-3) === inode) {
      return fields.at(-1);
    }
  }
  return undefined;
}

/** Every process holding the socket of that inode; one this user cannot read holds none. */
async function holdersOf(inode: string): Promise<number[]> {
  const link = `socket:[${inode}]`;
  const pids = (await readdir('/proc')).filter((entry) => /^\d+$/.test(entry));
  const holding = await Promise.all(
    pids.map(async (pid) => {
      const fds = await readdir(`/proc/${pid}/fd`).catch(() => []);
      for (const fd of fds) {
        if ((await readlink(`/proc/${pid}/fd/${fd}`).catch(() => '')) === link) {
          return [Number(pid)];
        }
      }
      return [];
    }),
  );
  return holding.flat();
}

/** The parent of a process, from its stat line, whose name may hold spaces and parentheses: the fields after its last `)`. */
async function parentOf(pid: number): Promise<number | undefined> {
  const stat = await readFile(`/proc/${String(pid)}/stat`, 'utf8').catch(() => '');
  const parent = Number(stat.slice(stat.lastIndexOf(')') + 1).trim().split(' ')[1]);
  return Number.isInteger(parent) ? parent : undefined;
}

async function isUnder(pid: number, roots: ReadonlySet<number>): Promise<boolean> {
  let current: number | undefined = pid;
  for (let step = 0; current !== undefined && current > 1 && step < MOST_ANCESTORS; step++) {
    if (roots.has(current)) {
      return true;
    }
    current = await parentOf(current);
  }
  return false;
}

export function createCallerCheck(options: {
  platform: string;
  /** The process the ship's session runs under on this machine, when it runs. */
  sessionRootOf: (shipId: ShipId) => Promise<number | undefined>;
  ownPid?: number;
  run?: typeof runCommand;
}): CallerCheck {
  if (options.platform !== 'linux') {
    return () => Promise.resolve(false);
  }
  const ownPid = options.ownPid ?? process.pid;
  const run = options.run ?? runCommand;
  return async (shipId, connection) => {
    const fd = descriptorOf(connection);
    if (fd === undefined) {
      return false;
    }
    try {
      const inode = SOCKET_LINK.exec(await readlink(`/proc/self/fd/${String(fd)}`))?.[1];
      const peer = inode === undefined ? undefined : await peerInodeOf(inode, run);
      const holders = peer === undefined ? [] : await holdersOf(peer);
      const root = await options.sessionRootOf(shipId);
      const roots = new Set(root === undefined ? [ownPid] : [ownPid, root]);
      const under = await Promise.all(holders.map((holder) => isUnder(holder, roots)));
      return under.length > 0 && under.every(Boolean);
    } catch {
      // A caller that does not resolve is refused, never allowed.
      return false;
    }
  };
}
