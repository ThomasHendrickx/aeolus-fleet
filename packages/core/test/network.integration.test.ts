import {
  ANY_LABEL_VALUE,
  createIdGenerator,
  SAME_LABEL_VALUE,
  type LabelId,
  type LabelValueId,
  type MessageId,
  type NetworkRule,
} from "@aeolus-fleet/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sha256Hasher } from "../src/adapters/crypto/secrets.js";
import { createSendMessage } from "../src/domain/messaging/send-message.js";
import { createApplyNetworkRules } from "../src/domain/registry/apply-network-rules.js";
import { createPrismaUnitOfWork } from "../src/adapters/prisma/unit-of-work.js";
import type { ShipCaller } from "../src/domain/shared/caller.js";
import type { Crew } from "../src/domain/shared/caller.js";
import {
  operatorCaller,
  secretOf,
  SESSION_MODEL,
} from "./support/core-fixtures.js";
import { newKey } from "../src/testing/keys.js";
import {
  createPostgresCore,
  everyRow,
  heldUnitOfWork,
  type PostgresCore,
} from "./support/postgres-core.js";
import { refusalOf, unwrap } from "../src/testing/result.js";
import { refusedShip } from "./support/refused-sender.js";
import { withOperatorLogin } from "./support/operator-login.js";
import { unsealedFleetsOnly } from "./support/sealing.js";

// The fleet's network rules on a real Postgres (decision 0034): the settings
// kept with their version, and a draft apart from them that only an apply
// puts in force; a refused send stores nothing but its record, in
// the transaction that refuses it; an answer found by its message's delivery;
// and a send and a change of rules taking turns on the settings, so every
// send is checked against exactly one version.

const newId = createIdGenerator();

let core: PostgresCore;
let argo: ShipCaller;
let planner: ShipCaller;
let vault: ShipCaller;
let labeller: ShipCaller;
let trustId: LabelId;
let shared: LabelValueId;
let sensitive: LabelValueId;

/** A ship the labeller commissions, so it may label it (decision 0046). */
async function aShip(name: string): Promise<ShipCaller> {
  const { shipId } = unwrap(
    await core.useCases.commissionShip(labeller, {
      idempotencyKey: newKey(),
      name,
      type: name,
    }),
  );
  return {
    fleetId: argo.fleetId,
    shipId,
    kind: "agent",
    scopes: ["messages:send", "messages:receive"],
  };
}

/** A crewed ship holding fleet:network, which edits and applies the rules (decision 0053). */
async function aNetworker(): Promise<Crew> {
  const { shipId, secret } = unwrap(
    await core.useCases.commissionShip(argo, {
      idempotencyKey: newKey(),
      name: "networking",
      type: "networking",
      scopes: ["fleet:network"],
    }),
  );
  const { crewToken } = unwrap(
    await core.useCases.claimShip({
      shipId,
      secret: secretOf(secret),
      location: { kind: "CLOUD" },
      harness: "claude-code",
    }),
  );
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}

/** Saves the rules as the draft and applies it at the version it was saved against: open goes off while a list applies. */
async function apply(
  networker: Crew,
  rules: readonly NetworkRule[] | null,
): Promise<{ version: number }> {
  const { savedAgainstVersion } = unwrap(
    await core.useCases.saveNetworkRulesDraft(networker, { rules }),
  );
  return unwrap(
    await core.useCases.applyNetworkRules(networker, {
      version: savedAgainstVersion,
    }),
  );
}

function aMessage(to: ShipCaller, inReplyTo?: MessageId) {
  return {
    selector: { kind: "ship" as const, shipId: to.shipId },
    payload: "Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/260",
    idempotencyKey: newKey(),
    model: SESSION_MODEL,
    inReplyTo,
  };
}

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(
    unwrap(
      await withOperatorLogin(
        core.prisma,
        core.useCases.initialiseFleet({ name: "home fleet" }),
      ),
    ),
  );
  const { shipId: labellerId } = unwrap(
    await core.useCases.commissionShip(argo, {
      idempotencyKey: newKey(),
      name: "labeller",
      type: "networking",
      scopes: ["fleet:commission", "labels:define", "labels:assign"],
    }),
  );
  labeller = {
    fleetId: argo.fleetId,
    shipId: labellerId,
    kind: "agent",
    scopes: ["fleet:commission", "labels:define", "labels:assign"],
  };
  planner = await aShip("planner");
  vault = await aShip("vault");
  const trust = unwrap(
    await core.useCases.defineLabel(labeller, {
      key: "trust",
      values: ["shared", "sensitive"],
    }),
  );
  trustId = trust.labelId;
  shared = trust.values[0]?.id ?? newId("labelValue");
  sensitive = trust.values[1]?.id ?? newId("labelValue");
  unwrap(
    await core.useCases.assignLabel(labeller, {
      shipId: planner.shipId,
      valueId: shared,
    }),
  );
  unwrap(
    await core.useCases.assignLabel(labeller, {
      shipId: vault.shipId,
      valueId: sensitive,
    }),
  );
});

afterEach(async () => {
  await core.close();
});

async function stored() {
  const [messages, deliveries, accepted] = await Promise.all([
    core.prisma.message.count(),
    core.prisma.delivery.count(),
    core.prisma.event.count({ where: { type: "MessageAccepted" } }),
  ]);
  return { messages, deliveries, accepted };
}

describe("the network settings", () => {
  let networking: Crew;

  beforeEach(async () => {
    networking = await aNetworker();
  });

  it("keep none applied for a new fleet: no row until the first change", async () => {
    await expect(core.prisma.networkSettings.count()).resolves.toBe(0);
    expect(unwrap(await core.useCases.readNetworkRules(argo))).toEqual({
      applied: { rules: null, version: 0 },
      draft: null,
    });
  });

  it("keep the applied rules, each with its verb, at a version that moves on every apply", async () => {
    await apply(networking, [{ verb: "send", from: [shared], to: [] }]);
    const rules: NetworkRule[] = [
      { verb: "send", from: [shared, sensitive], to: [sensitive] },
      { verb: "read", from: [], to: [] },
      { verb: "manage", from: [], to: [] },
    ];

    expect(await apply(networking, rules)).toEqual({ version: 2 });
    await expect(
      core.prisma.networkSettings.findMany({
        select: { fleetId: true, rules: true, version: true },
      }),
    ).resolves.toEqual([{ fleetId: argo.fleetId, rules, version: 2 }]);
  });

  it("keep none again once all-to-all is applied, read back as none", async () => {
    await apply(networking, []);

    expect(await apply(networking, null)).toEqual({ version: 2 });
    await expect(
      core.prisma.networkSettings.findMany({
        select: { rules: true, version: true },
      }),
    ).resolves.toEqual([{ rules: null, version: 2 }]);
    expect(unwrap(await core.useCases.readNetworkRules(argo)).applied).toEqual({
      rules: null,
      version: 2,
    });
  });

  it("write NetworkRulesSet with the apply, in the same transaction", async () => {
    await apply(networking, []);

    await expect(
      core.prisma.event.findMany({
        where: { type: "NetworkRulesSet" },
        select: { details: true },
      }),
    ).resolves.toEqual([{ details: { version: 1, rules: 0 } }]);
  });

  it("keep the viewer reading as it was turned, with BuiltInRuleChanged in the same transaction", async () => {
    expect(
      unwrap(
        await core.useCases.setBuiltInRule(networking, {
          rule: "viewerRead",
          isOn: false,
        }),
      ),
    ).toEqual({ version: 1 });

    await expect(
      core.prisma.networkSettings.findMany({
        select: { builtInViewerRead: true, version: true },
      }),
    ).resolves.toEqual([{ builtInViewerRead: false, version: 1 }]);
    await expect(
      core.prisma.event.findMany({
        where: { type: "BuiltInRuleChanged" },
        select: { details: true },
      }),
    ).resolves.toEqual([
      { details: { rule: "viewerRead", isOn: false, version: 1 } },
    ]);
  });
});

describe("the draft of the rules on Postgres (decision 0034)", () => {
  let networking: Crew;

  beforeEach(async () => {
    networking = await aNetworker();
  });

  it("is kept apart from the applied rules, with when it was saved and against which version, one a fleet", async () => {
    await apply(networking, [{ verb: "send", from: [shared], to: [] }]);
    unwrap(
      await core.useCases.saveNetworkRulesDraft(networking, { rules: [] }),
    );
    const rules: NetworkRule[] = [
      {
        verb: "read",
        from: [shared],
        to: [{ labelId: trustId, value: ANY_LABEL_VALUE }],
      },
    ];

    unwrap(await core.useCases.saveNetworkRulesDraft(networking, { rules }));

    await expect(
      core.prisma.networkRulesDraft.findMany({
        select: {
          fleetId: true,
          rules: true,
          savedAt: true,
          savedAgainstVersion: true,
        },
      }),
    ).resolves.toEqual([
      {
        fleetId: argo.fleetId,
        rules,
        savedAt: core.clock.now(),
        savedAgainstVersion: 1,
      },
    ]);
    expect(unwrap(await core.useCases.readNetworkRules(argo))).toEqual({
      applied: {
        rules: [{ verb: "send", from: [shared], to: [] }],
        version: 1,
      },
      draft: { rules, savedAt: core.clock.now(), savedAgainstVersion: 1 },
    });
  });

  it("keeps a draft of none, read back as none", async () => {
    unwrap(
      await core.useCases.saveNetworkRulesDraft(networking, { rules: null }),
    );

    expect(unwrap(await core.useCases.readNetworkRules(argo)).draft).toEqual({
      rules: null,
      savedAt: core.clock.now(),
      savedAgainstVersion: 0,
    });
  });

  it("applied, becomes the rules in force and goes, with NetworkRulesSet in the same transaction", async () => {
    unwrap(
      await core.useCases.saveNetworkRulesDraft(networking, {
        rules: [{ verb: "send", from: [shared], to: [sensitive] }],
      }),
    );

    expect(
      unwrap(await core.useCases.applyNetworkRules(networking, { version: 0 })),
    ).toEqual({ version: 1 });

    await expect(core.prisma.networkRulesDraft.count()).resolves.toBe(0);
    await expect(
      core.prisma.event.findMany({
        where: { type: { in: ["NetworkRulesDraftSaved", "NetworkRulesSet"] } },
        orderBy: { seq: "asc" },
        select: { type: true },
      }),
    ).resolves.toEqual([
      { type: "NetworkRulesDraftSaved" },
      { type: "NetworkRulesSet" },
    ]);
    unwrap(await core.useCases.sendMessage(planner, aMessage(vault)));
  });

  it("is refused an apply once the settings moved past the version the caller saw, kept as it was", async () => {
    unwrap(
      await core.useCases.saveNetworkRulesDraft(networking, { rules: [] }),
    );
    unwrap(
      await core.useCases.setBuiltInRule(argo, {
        rule: "viewerRead",
        isOn: false,
      }),
    );

    expect(
      refusalOf(
        await core.useCases.applyNetworkRules(networking, { version: 0 }),
      ),
    ).toMatchObject({ kind: "NETWORK_SETTINGS_CHANGED" });
    await expect(core.prisma.networkRulesDraft.count()).resolves.toBe(1);
    await expect(
      core.prisma.networkSettings.findMany({
        select: { rules: true, version: true },
      }),
    ).resolves.toEqual([{ rules: null, version: 1 }]);
  });

  it("discarded, goes with NetworkRulesDraftDiscarded in the same transaction", async () => {
    unwrap(
      await core.useCases.saveNetworkRulesDraft(networking, { rules: [] }),
    );

    unwrap(await core.useCases.discardNetworkRulesDraft(networking));

    await expect(core.prisma.networkRulesDraft.count()).resolves.toBe(0);
    await expect(
      core.prisma.event.count({
        where: { type: "NetworkRulesDraftDiscarded" },
      }),
    ).resolves.toBe(1);
  });

  it("is never what a send is checked against", async () => {
    await apply(networking, [
      { verb: "send", from: [shared], to: [sensitive] },
    ]);

    unwrap(
      await core.useCases.saveNetworkRulesDraft(networking, { rules: [] }),
    );

    unwrap(await core.useCases.sendMessage(planner, aMessage(vault)));
  });

  it("stores nothing when NetworkRulesSet cannot be written", async () => {
    unwrap(
      await core.useCases.saveNetworkRulesDraft(networking, { rules: [] }),
    );
    const before = await everyRow(core.prisma);
    const failingApply = createApplyNetworkRules({
      uow: {
        run: (work) =>
          createPrismaUnitOfWork(core.prisma).run((tx) =>
            work({
              ...tx,
              events: { append: () => Promise.reject(new Error("disk full")) },
            }),
          ),
      },
      clock: core.clock,
      ids: newId,
    });

    await expect(failingApply(networking, { version: 0 })).rejects.toThrow(
      "disk full",
    );

    await expect(everyRow(core.prisma)).resolves.toBe(before);
  });
});

describe("a send under network rules", () => {
  beforeEach(async () => {
    await apply(await aNetworker(), [
      { verb: "send", from: [shared], to: [sensitive] },
    ]);
  });

  it("discovered, answers exactly the ships a send would reach, read from the store, and records nothing (decision 0047)", async () => {
    const before = await core.prisma.event.count();

    const [fromPlanner, fromVault] = [
      unwrap(await core.useCases.discover(planner)),
      unwrap(await core.useCases.discover(vault)),
    ];

    expect(fromPlanner).toEqual({
      ships: [
        {
          id: argo.shipId,
          name: "argo",
          type: "operator",
          kind: "operator",
          status: "crewed",
          statement: null,
          verified: [],
        },
        {
          id: vault.shipId,
          name: "vault",
          type: "vault",
          kind: "agent",
          status: "awaitingCrew",
          statement: null,
          verified: [],
        },
      ],
      types: [
        { type: "operator", reachable: 1 },
        { type: "vault", reachable: 1 },
      ],
    });
    expect(fromVault.ships.map((ship) => ship.name)).toEqual(["argo"]);
    await expect(core.prisma.event.count()).resolves.toBe(before);
    await expect(core.prisma.reachRefusal.count()).resolves.toBe(0);
  });

  it("goes through when a rule allows it", async () => {
    unwrap(await core.useCases.sendMessage(planner, aMessage(vault)));

    await expect(stored()).resolves.toEqual({
      messages: 1,
      deliveries: 1,
      accepted: 1,
    });
  });

  it("is refused when no rule allows it, storing no message, no delivery and no event, only its record", async () => {
    const refused = await core.useCases.sendMessage(vault, aMessage(planner));

    expect(refusalOf(refused)).toEqual({
      kind: "NOT_REACHABLE",
      message: "The network rules do not allow this send",
    });
    await expect(stored()).resolves.toEqual({
      messages: 0,
      deliveries: 0,
      accepted: 0,
    });
    await expect(core.prisma.reachRefusal.count()).resolves.toBe(1);
  });

  it("records who tried to reach whom, both ships with the labels they carried and their owners, the settings version and when", async () => {
    refusalOf(await core.useCases.sendMessage(vault, aMessage(planner)));
    const label = (valueId: LabelValueId, value: string) => ({
      labelId: trustId,
      key: "trust",
      valueId,
      value,
    });

    const read = unwrap(await core.useCases.readReachRefusals(argo, {})).items;

    expect(read[0]?.id).toMatch(/^rfs_/);
    expect(read).toEqual([
      {
        fleetId: argo.fleetId,
        id: read[0]?.id,
        at: core.clock.now(),
        sender: {
          kind: "ship",
          id: vault.shipId,
          name: "vault",
          labels: [label(sensitive, "sensitive")],
          owner: { id: argo.shipId, name: "argo" },
        },
        askedBy: null,
        recipient: {
          kind: "ship",
          ship: {
            id: planner.shipId,
            name: "planner",
            labels: [label(shared, "shared")],
            owner: { id: argo.shipId, name: "argo" },
          },
        },
        verb: "send",
        settingsVersion: 1,
      },
    ]);
  });

  it("explained to argo, answers the ships the sender reaches now, each with the rule that allows it, read from the store", async () => {
    const explained = unwrap(
      await core.useCases.explainReach(argo, { fromShipId: planner.shipId }),
    );

    expect(explained.send).toEqual([
      { shipId: argo.shipId, rule: { builtIn: "argo" } },
      { shipId: vault.shipId, rule: { rule: 0 } },
    ]);
  });

  it("lets a ship answer the sender of a message it received", async () => {
    const asked = unwrap(
      await core.useCases.sendMessage(planner, aMessage(vault)),
    ).messageId;

    await expect(
      core.useCases.sendMessage(vault, aMessage(planner, asked)),
    ).resolves.toMatchObject({ isOk: true });
  });
});

describe("a send under rules with terms of any value and of the same value", () => {
  let networking: Crew;
  let scout: ShipCaller;

  beforeEach(async () => {
    networking = await aNetworker();
    scout = await aShip("scout");
    unwrap(
      await core.useCases.assignLabel(labeller, {
        shipId: scout.shipId,
        valueId: shared,
      }),
    );
  });

  const anyTrust = () => ({ labelId: trustId, value: ANY_LABEL_VALUE });
  const sameTrust = () => ({ labelId: trustId, value: SAME_LABEL_VALUE });

  it("keeps the terms as they were applied", async () => {
    const rules = [
      { verb: "send" as const, from: [shared, anyTrust()], to: [] },
      { verb: "send" as const, from: [sameTrust()], to: [sameTrust()] },
    ];

    await apply(networking, rules);

    await expect(
      core.prisma.networkSettings.findMany({ select: { rules: true } }),
    ).resolves.toEqual([{ rules }]);
  });

  it("keeps terms of the owner, and lets ships with the same owner reach each other, read from the store", async () => {
    const rules = [
      {
        verb: "send" as const,
        from: [{ owner: SAME_LABEL_VALUE }],
        to: [{ owner: SAME_LABEL_VALUE }],
      },
    ];
    const { shipId: thomasId } = unwrap(
      await core.useCases.commissionShip(argo, {
        idempotencyKey: newKey(),
        name: "thomas",
        type: "person",
        kind: "person",
      }),
    );
    unwrap(
      await core.useCases.setOwner(argo, {
        shipId: scout.shipId,
        ownerShipId: thomasId,
      }),
    );

    await apply(networking, rules);

    await expect(
      core.prisma.networkSettings.findMany({ select: { rules: true } }),
    ).resolves.toEqual([{ rules }]);
    unwrap(await core.useCases.sendMessage(vault, aMessage(planner)));
    expect(
      refusalOf(await core.useCases.sendMessage(scout, aMessage(planner))),
    ).toMatchObject({ kind: "NOT_REACHABLE" });
  });

  it("lets a ship carrying any value of the label send under a term of any value, and no ship without it", async () => {
    await apply(networking, [{ verb: "send", from: [anyTrust()], to: [] }]);
    const loner = await aShip("loner");

    unwrap(await core.useCases.sendMessage(vault, aMessage(planner)));
    expect(
      refusalOf(await core.useCases.sendMessage(loner, aMessage(planner))),
    ).toMatchObject({ kind: "NOT_REACHABLE" });
  });

  it("lets ships carrying the same value reach each other under a term of the same value, and records the refusal of different values", async () => {
    await apply(networking, [
      { verb: "send", from: [sameTrust()], to: [sameTrust()] },
    ]);

    unwrap(await core.useCases.sendMessage(planner, aMessage(scout)));
    expect(
      refusalOf(await core.useCases.sendMessage(planner, aMessage(vault))),
    ).toMatchObject({ kind: "NOT_REACHABLE" });
    const [refusal] = unwrap(
      await core.useCases.readReachRefusals(argo, {}),
    ).items;
    expect([
      refusal && refusedShip(refusal.sender).labels.map((label) => label.value),
      refusal?.recipient.kind === "ship"
        ? refusal.recipient.ship.labels.map((label) => label.value)
        : undefined,
    ]).toEqual([["shared"], ["sensitive"]]);
  });

  it("explained to argo, answers only the ships with the same value under a term of the same value", async () => {
    await apply(networking, [
      { verb: "send", from: [sameTrust()], to: [sameTrust()] },
    ]);

    const explained = unwrap(
      await core.useCases.explainReach(argo, { fromShipId: planner.shipId }),
    );

    expect(explained.send.map((reached) => reached.shipId)).toEqual([
      argo.shipId,
      scout.shipId,
    ]);
  });

  it("keeps as claimants of a send to a type only its ships with the same value", async () => {
    await apply(networking, [
      { verb: "send", from: [sameTrust()], to: [sameTrust()] },
    ]);
    const { shipId: keeperId } = unwrap(
      await core.useCases.commissionShip(labeller, {
        idempotencyKey: newKey(),
        name: "keeper",
        type: "vault",
      }),
    );
    unwrap(
      await core.useCases.assignLabel(labeller, {
        shipId: keeperId,
        valueId: shared,
      }),
    );

    const { messageId } = unwrap(
      await core.useCases.sendMessage(planner, {
        ...aMessage(vault),
        selector: { kind: "type", type: "vault" },
      }),
    );

    await expect(
      core.prisma.delivery.findMany({
        where: { messageId },
        select: { reachableShipIds: true },
      }),
    ).resolves.toEqual([{ reachableShipIds: [keeperId] }]);
  });
});

describe("a send and an apply of rules", () => {
  let networking: Crew;

  beforeEach(async () => {
    networking = await aNetworker();
    await apply(networking, [
      { verb: "send", from: [shared], to: [sensitive] },
    ]);
    unwrap(
      await core.useCases.saveNetworkRulesDraft(networking, { rules: [] }),
    );
  });

  it("take turns: a send that comes while a change is under way waits for it and is checked against the new version", async () => {
    const { uow, reached } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      networkSettings: {
        ...tx.networkSettings,
        findForUpdate: async (fleetId) => {
          const settings = await tx.networkSettings.findForUpdate(fleetId);
          await hold();
          return settings;
        },
      },
    }));
    const change = createApplyNetworkRules({
      uow,
      clock: core.clock,
      ids: newId,
    })(networking, { version: 1 });
    await reached;

    const refused = await core.useCases.sendMessage(planner, aMessage(vault));

    expect(unwrap(await change)).toEqual({ version: 2 });
    expect(refusalOf(refused).kind).toBe("NOT_REACHABLE");
    await expect(
      core.prisma.reachRefusal.findMany({ select: { settingsVersion: true } }),
    ).resolves.toEqual([{ settingsVersion: 2 }]);
  });

  it("take turns: a change that comes while a send is under way waits for it, and the send goes through under the version it was checked against", async () => {
    const { uow, reached } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      networkSettings: {
        ...tx.networkSettings,
        findForShare: async (fleetId) => {
          const settings = await tx.networkSettings.findForShare(fleetId);
          await hold();
          return settings;
        },
      },
    }));
    const send = createSendMessage({
      sealing: unsealedFleetsOnly,
      uow,
      clock: core.clock,
      ids: newId,
      hasher: sha256Hasher,
    })(planner, aMessage(vault));
    await reached;

    const change = await core.useCases.applyNetworkRules(networking, {
      version: 1,
    });

    expect(unwrap(await send).messageId).toMatch(/^msg_/);
    expect(unwrap(change)).toEqual({ version: 2 });
    const events = await core.prisma.event.findMany({
      where: { type: { in: ["MessageAccepted", "NetworkRulesSet"] } },
      orderBy: { seq: "asc" },
      select: { type: true },
    });
    expect(events.map((event) => event.type)).toEqual([
      "NetworkRulesSet",
      "MessageAccepted",
      "NetworkRulesSet",
    ]);
  });

  it("racing, check every send against exactly one version: each one stored before the change, each one refused after it", async () => {
    const send = () => core.useCases.sendMessage(planner, aMessage(vault));
    const before = Array.from({ length: 6 }, send);
    const change = core.useCases.applyNetworkRules(networking, { version: 1 });
    const sends = [...before, ...Array.from({ length: 6 }, send)];

    const results = await Promise.all(sends);
    unwrap(await change);

    const events = await core.prisma.event.findMany({
      where: { type: { in: ["MessageAccepted", "NetworkRulesSet"] } },
      orderBy: { seq: "asc" },
      select: { type: true, details: true },
    });
    const changedAt = events.findIndex(
      (event) =>
        event.type === "NetworkRulesSet" &&
        JSON.stringify(event.details).includes('"version":2'),
    );
    expect(
      events.slice(changedAt + 1).map((event) => event.type),
    ).not.toContain("MessageAccepted");
    const refusals = await core.prisma.reachRefusal.findMany({
      select: { settingsVersion: true },
    });
    // The sends started after the change queue behind it: the race has both sides.
    expect(refusals.length).toBeGreaterThan(0);
    expect(refusals.every((refusal) => refusal.settingsVersion === 2)).toBe(
      true,
    );
    expect(
      results.filter((result) => result.isOk).length + refusals.length,
    ).toBe(sends.length);
    expect(results.filter((result) => !result.isOk).length).toBe(
      refusals.length,
    );
  });
});

describe("a send to a type under network rules", () => {
  /** A crewed ship of type keeper, carrying the given trust value. */
  async function crewedKeeper(
    name: string,
    trust: LabelValueId,
  ): Promise<Crew> {
    const { shipId, secret } = unwrap(
      await core.useCases.commissionShip(labeller, {
        idempotencyKey: newKey(),
        name,
        type: "keeper",
      }),
    );
    unwrap(
      await core.useCases.assignLabel(labeller, { shipId, valueId: trust }),
    );
    const { crewToken } = unwrap(
      await core.useCases.claimShip({
        shipId,
        secret: secretOf(secret),
        location: { kind: "CLOUD" },
        harness: "claude-code",
      }),
    );
    return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
  }

  const toKeepers = { kind: "type" as const, type: "keeper" };

  beforeEach(async () => {
    await apply(await aNetworker(), [
      { verb: "send", from: [shared], to: [shared] },
    ]);
  });

  it("is claimed and counted only by a ship of the type the sender may reach, fixed at send time", async () => {
    const reachable = await crewedKeeper("keeper-a", shared);
    const unreachable = await crewedKeeper("keeper-b", sensitive);
    const { messageId } = unwrap(
      await core.useCases.sendMessage(planner, {
        ...aMessage(vault),
        selector: toKeepers,
      }),
    );

    await expect(
      core.prisma.delivery.findMany({ select: { reachableShipIds: true } }),
    ).resolves.toEqual([{ reachableShipIds: [reachable.shipId] }]);
    expect(
      unwrap(await core.useCases.checkInbox(unreachable, { waitSeconds: 0 })),
    ).toEqual({ waiting: 0, forced: 0 });
    expect(
      unwrap(await core.useCases.checkInbox(reachable, { waitSeconds: 0 })),
    ).toEqual({ waiting: 1, forced: 0 });
    expect(
      unwrap(
        await core.useCases.receiveDeliveries(reachable, { max: 10 }),
      ).deliveries.map((delivery) => delivery.messageId),
    ).toEqual([messageId]);
  });

  it("is refused when the sender may reach no ship of the type, recording the type and each ship of it", async () => {
    const unreachable = await crewedKeeper("keeper-b", sensitive);

    refusalOf(
      await core.useCases.sendMessage(planner, {
        ...aMessage(vault),
        selector: toKeepers,
      }),
    );

    const [refusal] = unwrap(
      await core.useCases.readReachRefusals(argo, {}),
    ).items;
    expect(refusal?.recipient).toEqual({
      kind: "type",
      type: "keeper",
      ships: [
        {
          id: unreachable.shipId,
          name: "keeper-b",
          labels: [
            {
              labelId: trustId,
              key: "trust",
              valueId: sensitive,
              value: "sensitive",
            },
          ],
          owner: { id: argo.shipId, name: "argo" },
        },
      ],
    });
  });

  it("stays open to every ship of the type for argo's send: no ships kept", async () => {
    await crewedKeeper("keeper-b", sensitive);

    unwrap(
      await core.useCases.sendMessage(argo, {
        ...aMessage(vault),
        selector: toKeepers,
        model: undefined,
      }),
    );

    await expect(
      core.prisma.delivery.findMany({ select: { reachableShipIds: true } }),
    ).resolves.toEqual([{ reachableShipIds: [] }]);
  });
});

describe("declared network rules on Postgres (decision 0037)", () => {
  const sameTrust = (): NetworkRule => ({
    verb: "send",
    from: [{ labelId: trustId, value: SAME_LABEL_VALUE }],
    to: [{ labelId: trustId, value: SAME_LABEL_VALUE }],
  });

  it("keeps each ship's whole list, in ship order, replacing it and withdrawing it with none", async () => {
    unwrap(
      await core.useCases.declareNetworkRules(labeller, {
        rules: [
          sameTrust(),
          {
            verb: "send",
            from: [shared],
            to: [{ labelId: trustId, value: ANY_LABEL_VALUE }],
          },
        ],
      }),
    );
    unwrap(
      await core.useCases.declareNetworkRules(labeller, {
        rules: [sameTrust()],
      }),
    );
    const networker = await aNetworker();

    await expect(
      core.useCases.readDeclaredNetworkRules(networker),
    ).resolves.toEqual([
      {
        declarer: { kind: "ship", shipId: labeller.shipId },
        rules: [sameTrust()],
      },
    ]);
    unwrap(await core.useCases.declareNetworkRules(labeller, { rules: [] }));
    await expect(
      core.useCases.readDeclaredNetworkRules(networker),
    ).resolves.toEqual([]);
    await expect(core.prisma.declaredNetworkRules.count()).resolves.toBe(0);
  });

  it("withdraws them when the declaring ship retires, in its unit of work", async () => {
    unwrap(
      await core.useCases.declareNetworkRules(labeller, {
        rules: [sameTrust()],
      }),
    );

    unwrap(await core.useCases.retireShip(argo, { shipId: labeller.shipId }));

    await expect(core.prisma.declaredNetworkRules.count()).resolves.toBe(0);
    await expect(
      core.prisma.event.count({
        where: { type: "NetworkRulesDeclared", shipId: labeller.shipId },
      }),
    ).resolves.toBe(2);
  });

  it("keeps the fleet's own 200 rules beside the declared ones, and refuses 201", async () => {
    unwrap(
      await core.useCases.declareNetworkRules(labeller, {
        rules: [sameTrust(), sameTrust()],
      }),
    );
    const networker = await aNetworker();

    expect(
      unwrap(
        await core.useCases.saveNetworkRulesDraft(networker, {
          rules: Array.from({ length: 200 }, sameTrust),
        }),
      ),
    ).toEqual({ savedAgainstVersion: 1 });
    expect(
      refusalOf(
        await core.useCases.saveNetworkRulesDraft(networker, {
          rules: Array.from({ length: 201 }, sameTrust),
        }),
      ),
    ).toMatchObject({ kind: "INVALID_NETWORK_RULES" });
  });

  it("puts them in force beside the applied rules, read from the store, moving the settings version so a refusal names it", async () => {
    await apply(await aNetworker(), []);
    refusalOf(await core.useCases.sendMessage(planner, aMessage(vault)));

    unwrap(
      await core.useCases.declareNetworkRules(labeller, {
        rules: [{ verb: "send", from: [shared], to: [sensitive] }],
      }),
    );

    unwrap(await core.useCases.sendMessage(planner, aMessage(vault)));
    await expect(
      core.prisma.networkSettings.findMany({ select: { version: true } }),
    ).resolves.toEqual([{ version: 2 }]);
    await expect(
      core.prisma.event.findMany({
        where: { type: "NetworkRulesDeclared" },
        select: { details: true },
      }),
    ).resolves.toEqual([{ details: { rules: 1, version: 2 } }]);
  });
});
