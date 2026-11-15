import { describe, expect, it } from "vitest";

import {
  type StaleSweepRuntime,
  type SweepRuntime,
  removeStaleContainers,
  sweep,
  testContainerLabels,
} from "../src/testing/container-sweeper.js";

const TIMING = { delayMs: 1, maxLists: 5 };

/** A container runtime that answers each list from a script, the last one again and again, and records what is removed. */
class FakeRuntime implements SweepRuntime {
  readonly removed: string[] = [];
  listed = 0;

  constructor(private readonly lists: string[][]) {}

  listContainerIds(): Promise<string[]> {
    return Promise.resolve(
      this.lists[Math.min(this.listed++, this.lists.length - 1)] ?? [],
    );
  }

  removeContainer(id: string): Promise<void> {
    this.removed.push(id);
    return Promise.resolve();
  }
}

describe("the sweep of a test run", () => {
  it("removes a container whose create request finished after the first list", async () => {
    const runtime = new FakeRuntime([["early"], [], ["late"], [], []]);

    await sweep(runtime, { run: "run", timing: TIMING });

    expect(runtime.removed).toEqual(["early", "late"]);
  });

  it("lists again before it ends when the first list is empty", async () => {
    const runtime = new FakeRuntime([[], ["late"], [], []]);

    await sweep(runtime, { run: "run", timing: TIMING });

    expect(runtime.removed).toEqual(["late"]);
  });

  it("ends after two empty lists in a row", async () => {
    const runtime = new FakeRuntime([["a"], [], []]);

    await sweep(runtime, { run: "run", timing: TIMING });

    expect(runtime.listed).toBe(3);
  });

  it("stops after the most lists when containers keep appearing", async () => {
    const runtime = new FakeRuntime([["a"]]);

    await sweep(runtime, { run: "run", timing: TIMING });

    expect(runtime.listed).toBe(TIMING.maxLists);
  });

  it("goes on when a container is already gone", async () => {
    const runtime = new FakeRuntime([["a"], [], []]);
    runtime.removeContainer = () => Promise.reject(new Error("not found"));

    await expect(
      sweep(runtime, { run: "run", timing: TIMING }),
    ).resolves.toBeUndefined();
  });

  it("does not wait after the last list it takes", async () => {
    const runtime = new FakeRuntime([["a"]]);

    const outcome = await Promise.race([
      sweep(runtime, {
        run: "run",
        timing: { delayMs: 60_000, maxLists: 1 },
      }).then(() => "done"),
      new Promise((resolve) => setTimeout(() => { resolve("waiting"); }, 100)),
    ]);

    expect(outcome).toBe("done");
  });
});

const HOUR_MS = 3_600_000;
const NOW = new Date("2026-11-16T12:00:00.000Z");

/** The containers of this repository's test runs, each created some hours before now. */
class FakeRepositoryRuntime implements StaleSweepRuntime {
  readonly removed: string[] = [];

  constructor(private readonly ageHours: Record<string, number>) {}

  listRepositoryContainers(): Promise<{ id: string; createdAt: Date }[]> {
    return Promise.resolve(
      Object.entries(this.ageHours).map(([id, hours]) => ({
        id,
        createdAt: new Date(NOW.getTime() - hours * HOUR_MS),
      })),
    );
  }

  removeContainer(id: string): Promise<void> {
    this.removed.push(id);
    return Promise.resolve();
  }
}

describe("the removal of stale test containers", () => {
  it("removes the containers older than 24 hours and keeps the others", async () => {
    const runtime = new FakeRepositoryRuntime({ old: 25, week: 168, recent: 23, fresh: 0 });

    await removeStaleContainers(runtime, { now: NOW });

    expect(runtime.removed).toEqual(["old", "week"]);
  });

  it("goes on when a container is already gone", async () => {
    const runtime = new FakeRepositoryRuntime({ a: 30, b: 30 });
    runtime.removeContainer = () => Promise.reject(new Error("not found"));

    await expect(removeStaleContainers(runtime, { now: NOW })).resolves.toBeUndefined();
  });
});

describe("the labels of a test container", () => {
  it("name the repository and the run", () => {
    expect(testContainerLabels("run-1")).toEqual({
      "aeolus-fleet.repository": "aeolus-fleet",
      "aeolus-fleet.test-run": "run-1",
    });
  });
});
