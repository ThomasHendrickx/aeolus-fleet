import { execFileSync, spawn } from "node:child_process";
import { Socket } from "node:net";
import { fileURLToPath } from "node:url";

import { getContainerRuntimeClient } from "testcontainers";

/**
 * The label every container a test run starts carries, its value the run. The
 * sweeper removes a run's containers by it, and CI checks by it that a run left
 * none behind.
 */
export const TEST_RUN_LABEL = "aeolus-fleet.test-run";

/** The label of the pid of the run's process, so the sweep can tell a run that lives from one that ended. */
export const RUN_PID_LABEL = "aeolus-fleet.test-run-pid";

/** The label of the start of the run's process as the platform tells it: a pid alone can be reused by another process. */
export const RUN_STARTED_LABEL = "aeolus-fleet.test-run-started";

/** The label every test container carries, its value the repository, so a container of this repository is found whatever run started it. */
export const REPOSITORY_LABEL = "aeolus-fleet.repository";

const REPOSITORY = "aeolus-fleet";

/** The process of the run that started a container. */
export interface RunOwner {
  readonly pid: number;
  readonly startedAt: string;
}

/**
 * The start of a process as the platform tells it, undefined when the process
 * does not exist or the platform cannot tell (no ps, as on Windows).
 */
export function processStart(pid: number): string | undefined {
  try {
    const started = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return started === "" ? undefined : started;
  } catch {
    return undefined;
  }
}

/**
 * Whether the process of a run lives: true when it exists and started when the
 * label says, false when it is gone or another process has its pid, undefined
 * when that cannot be checked.
 */
export function isRunAlive(owner: RunOwner): Promise<boolean | undefined> {
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    // EPERM: the process exists, owned by another user.
    if (!(error instanceof Error && "code" in error && error.code === "EPERM")) {
      return Promise.resolve(false);
    }
  }
  const started = processStart(owner.pid);
  return Promise.resolve(
    started === undefined ? undefined : started === owner.startedAt,
  );
}

/** The labels of a container the run starts: its repository, the run, and the pid and start of the run's process. */
export function testContainerLabels(run: string): Record<string, string> {
  const labels = { [REPOSITORY_LABEL]: REPOSITORY, [TEST_RUN_LABEL]: run };
  const startedAt = processStart(process.pid);
  return startedAt === undefined
    ? labels
    : { ...labels, [RUN_PID_LABEL]: String(process.pid), [RUN_STARTED_LABEL]: startedAt };
}

/** A test container older than this is a leak where liveness cannot be checked: no run lasts that long. */
const STALE_AFTER_MS = 24 * 3_600_000;

/** The part of the container runtime the removal of stale containers uses. */
export interface StaleSweepRuntime {
  listRepositoryContainers(): Promise<
    { id: string; createdAt: Date; owner?: RunOwner }[]
  >;
  removeContainer(id: string): Promise<void>;
}

/**
 * Removes this repository's test containers whose run ended, whichever run
 * started them: a run that was killed or timed out never reached its teardown,
 * and its sweeper may have died too. A container whose run's process lives is
 * kept however old, and one whose run's process is gone is removed. Where
 * liveness cannot be checked (no owner labels, no way to read a process start)
 * the age decides: older than 24 hours is a leak.
 */
export async function removeStaleContainers(
  runtime: StaleSweepRuntime,
  {
    now = new Date(),
    isRunAlive: isAlive = isRunAlive,
  }: {
    now?: Date;
    isRunAlive?: (owner: RunOwner) => Promise<boolean | undefined>;
  } = {},
): Promise<void> {
  const containers = await runtime.listRepositoryContainers();
  const removable: string[] = [];
  for (const { id, createdAt, owner } of containers) {
    const isLive = owner === undefined ? undefined : await isAlive(owner);
    const isStale = now.getTime() - createdAt.getTime() > STALE_AFTER_MS;
    if (isLive === false || (isLive === undefined && isStale)) {
      removable.push(id);
    }
  }
  // A container removed meanwhile answers not found: it is gone either way.
  await Promise.allSettled(removable.map((id) => runtime.removeContainer(id)));
}

/** Removes this repository's stale test containers from the container runtime of this machine. */
export async function removeStaleTestContainers(): Promise<void> {
  const { dockerode } = (await getContainerRuntimeClient()).container;
  await removeStaleContainers({
    async listRepositoryContainers() {
      const containers = await dockerode.listContainers({
        all: true,
        filters: { label: [`${REPOSITORY_LABEL}=${REPOSITORY}`] },
      });
      // Created is in seconds.
      return containers.map((container) => {
        const labels: Record<string, string | undefined> = container.Labels;
        const pid = Number(labels[RUN_PID_LABEL]);
        const startedAt = labels[RUN_STARTED_LABEL];
        return {
          id: container.Id,
          createdAt: new Date(container.Created * 1000),
          owner:
            Number.isInteger(pid) && startedAt !== undefined
              ? { pid, startedAt }
              : undefined,
        };
      });
    },
    async removeContainer(id) {
      await dockerode.getContainer(id).remove({ force: true, v: true });
    },
  });
}

/**
 * Starts the sweeper of a test run: a process of its own that removes the
 * run's containers with their volumes once the run's process ends, however it
 * ends. A run's teardown removes them too, but an interrupted or killed run
 * never reaches it, and rootless Podman often runs no Testcontainers reaper
 * (#1581). The sweeper learns the run ended when the pipe from the run's
 * process closes, which the operating system does for a killed process too. It
 * runs in a process group of its own, so the Ctrl-C that interrupts the run
 * does not stop it, and it keeps the run's process from exiting by nothing.
 * The file is the sweeper: this function starts it again as a program.
 */
export function startContainerSweeper(run: string): void {
  const sweeper = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), run],
    {
      detached: true,
      stdio: ["pipe", "ignore", "inherit"],
    },
  );
  sweeper.unref();
  // The pipe is a socket: unreferenced, it keeps the run's process from exiting by nothing either.
  if (sweeper.stdin instanceof Socket) {
    sweeper.stdin.unref();
  }
}

/** The part of the container runtime the sweep uses. */
export interface SweepRuntime {
  listContainerIds(run: string): Promise<string[]>;
  removeContainer(id: string): Promise<void>;
}

/** How long the sweep waits between two lists, and how many lists it takes at most. */
export interface SweepTiming {
  readonly delayMs: number;
  readonly maxLists: number;
}

const DEFAULT_TIMING: SweepTiming = { delayMs: 1_000, maxLists: 10 };

/**
 * Removes every container of the run, running or not, with its anonymous
 * volumes. A container whose create request was still in flight when the run's
 * process died can appear after a list, so the sweep removes what it lists and
 * lists again after a short delay, until two lists in a row are empty. It stops after the most lists the timing allows.
 */
export async function sweep(
  runtime: SweepRuntime,
  { run, timing = DEFAULT_TIMING }: { run: string; timing?: SweepTiming },
): Promise<void> {
  let previous: string[] | undefined;
  for (let lists = 1; lists <= timing.maxLists; lists++) {
    const ids = await runtime.listContainerIds(run);
    if (previous?.length === 0 && ids.length === 0) {
      return;
    }
    // A container the run's teardown removes meanwhile answers not found: it is gone either way.
    await Promise.allSettled(ids.map((id) => runtime.removeContainer(id)));
    previous = ids;
    if (lists === timing.maxLists) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, timing.delayMs));
  }
}

async function dockerRuntime(): Promise<SweepRuntime> {
  const { dockerode } = (await getContainerRuntimeClient()).container;
  return {
    async listContainerIds(run) {
      const containers = await dockerode.listContainers({
        all: true,
        filters: { label: [`${TEST_RUN_LABEL}=${run}`] },
      });
      return containers.map((container) => container.Id);
    },
    async removeContainer(id) {
      await dockerode.getContainer(id).remove({ force: true, v: true });
    },
  };
}

if (import.meta.main) {
  const run = process.argv[2];
  if (!run) {
    console.error("Usage: node container-sweeper.ts <test run>");
    process.exit(2);
  }
  process.stdin.on("end", () => {
    dockerRuntime()
      .then((runtime) => sweep(runtime, { run }))
      .catch((error: unknown) => {
        console.error(
          `The sweeper of test run ${run} could not remove its containers:`,
          error,
        );
        process.exitCode = 1;
      });
  });
  process.stdin.resume();
}
