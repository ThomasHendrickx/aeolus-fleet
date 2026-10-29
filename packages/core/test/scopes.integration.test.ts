import {
  createIdGenerator,
  SCOPES,
  type FleetId,
  type ShipId,
} from "@aeolus-fleet/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cryptoRandomTokens,
  sha256Hasher,
} from "../src/adapters/crypto/secrets.js";
import { createCommissionShip } from "../src/domain/registry/commission-ship.js";
import { secretOf } from "./support/core-fixtures.js";
import { newKey } from "../src/testing/keys.js";
import {
  createPostgresCore,
  heldUnitOfWork,
  type PostgresCore,
} from "./support/postgres-core.js";
import { unwrap } from "../src/testing/result.js";
import { withOperatorLogin } from "./support/operator-login.js";

// Scopes on a real Postgres (decision 0046): a ship holds core scopes and
// plugin scopes, each <namespace>:<action>.

let core: PostgresCore;
let fleetId: FleetId;
let argoId: ShipId;

beforeEach(async () => {
  core = await createPostgresCore();
  ({ fleetId, operatorShipId: argoId } = unwrap(
    await withOperatorLogin(
      core.prisma,
      core.useCases.initialiseFleet({ name: "home fleet" }),
    ),
  ));
});

afterEach(async () => {
  await core.close();
});

const argo = () => ({
  shipId: argoId,
  fleetId,
  kind: "operator" as const,
  scopes: [...SCOPES],
});

/** A commissioned ship a session claimed: its id and crew token. */
async function claimedScout(): Promise<{ shipId: ShipId; crewToken: string }> {
  const commissioned = unwrap(
    await core.useCases.commissionShip(argo(), {
      idempotencyKey: newKey(),
      name: "scout",
      type: "reviewer",
    }),
  );
  const { crewToken } = unwrap(
    await core.useCases.claimShip({
      shipId: commissioned.shipId,
      secret: secretOf(commissioned.secret),
      location: { kind: "DEVICE" },
      harness: "claude-code",
    }),
  );
  return { shipId: commissioned.shipId, crewToken };
}

describe("a ship's scopes on Postgres", () => {
  it("hold a plugin's scope beside the core ones", async () => {
    const { shipId } = await claimedScout();

    await expect(
      core.prisma.ship.update({
        where: { id: shipId },
        data: {
          scopes: ["messages:send", "messages:receive", "squadrons:form"],
        },
      }),
    ).resolves.toMatchObject({
      scopes: ["messages:send", "messages:receive", "squadrons:form"],
    });
  });

  it.each([
    ["a malformed scope", "Squadrons:form"],
    ["a scope with no action", "squadrons"],
    ["an unknown scope of a core namespace", "fleet:write"],
  ])("refuse %s", async (_what, scope) => {
    const { shipId } = await claimedScout();

    await expect(
      core.prisma.ship.update({
        where: { id: shipId },
        data: { scopes: ["messages:send", scope] },
      }),
    ).rejects.toThrow(/ships_scopes_known/);
  });

  it("reach the crew's caller, a plugin's scope included, so it is checked at the next call", async () => {
    const { shipId, crewToken } = await claimedScout();
    await core.prisma.ship.update({
      where: { id: shipId },
      data: { scopes: ["messages:send", "messages:receive", "squadrons:form"] },
    });

    await expect(
      core.useCases.authenticate.byCrewToken(crewToken),
    ).resolves.toMatchObject({
      isOk: true,
      value: {
        shipId,
        scopes: ["messages:send", "messages:receive", "squadrons:form"],
      },
    });
  });
});

describe("declaring scopes on Postgres", () => {
  const FORM = {
    scope: "squadrons:form",
    description: "Form a squadron by message",
  };

  /** A commissioned ship as the caller its crew token resolves to. */
  async function plugin(name: string) {
    const { shipId } = unwrap(
      await core.useCases.commissionShip(argo(), {
        idempotencyKey: newKey(),
        name,
        type: "plugin",
      }),
    );
    return {
      shipId,
      fleetId,
      kind: "agent" as const,
      scopes: ["messages:send", "messages:receive", "scopes:declare"],
    };
  }

  it("keeps the namespace with its scopes and their descriptions in order, and writes ScopesDeclared in the same transaction", async () => {
    const squadrons = await plugin("squadrons");
    const scale = {
      scope: "squadrons:scale",
      description: "Add and remove members",
    };

    unwrap(
      await core.useCases.declareScopes(squadrons, {
        namespace: "squadrons",
        scopes: [FORM, scale],
      }),
    );

    await expect(
      core.useCases.listScopes(argo()).then((listed) => listed.at(-1)),
    ).resolves.toEqual({
      namespace: "squadrons",
      kind: "plugin",
      declaredBy: { id: squadrons.shipId, name: "squadrons" },
      scopes: [FORM, scale],
    });
    await expect(
      core.prisma.event.findMany({
        where: { type: "ScopesDeclared" },
        select: { shipId: true, details: true },
      }),
    ).resolves.toEqual([
      {
        shipId: squadrons.shipId,
        details: { namespace: "squadrons", scopes: 2 },
      },
    ]);
  });

  it("gives a namespace to one of two ships declaring it at once", async () => {
    const [first, second] = [await plugin("squadrons"), await plugin("rival")];

    const declared = await Promise.all(
      [first, second].map((ship) =>
        core.useCases.declareScopes(ship, {
          namespace: "squadrons",
          scopes: [FORM],
        }),
      ),
    );

    expect(
      declared
        .map((result) => (result.isOk ? "declared" : result.error.kind))
        .toSorted(),
    ).toEqual(["NAMESPACE_TAKEN", "declared"]);
    await expect(
      core.useCases
        .listScopes(argo())
        .then((listed) => listed.slice(6).map(({ namespace }) => namespace)),
    ).resolves.toEqual(["squadrons"]);
  });

  it("gives one ship one of two namespaces it declares at once", async () => {
    const squadrons = await plugin("squadrons");

    const declared = await Promise.all(
      ["squadrons", "fleets"].map((namespace) =>
        core.useCases.declareScopes(squadrons, { namespace, scopes: [] }),
      ),
    );

    expect(
      declared
        .map((result) => (result.isOk ? "declared" : result.error.kind))
        .toSorted(),
    ).toEqual(["SECOND_NAMESPACE", "declared"]);
    await expect(
      core.useCases.listScopes(argo()).then((listed) => listed.slice(6)),
    ).resolves.toHaveLength(1);
  });

  it("refuses to remove a scope an active ship holds, and keeps the list it had", async () => {
    const squadrons = await plugin("squadrons");
    unwrap(
      await core.useCases.declareScopes(squadrons, {
        namespace: "squadrons",
        scopes: [FORM],
      }),
    );
    const { shipId } = await claimedScout();
    await core.prisma.ship.update({
      where: { id: shipId },
      data: { scopes: ["messages:send", "messages:receive", "squadrons:form"] },
    });

    await expect(
      core.useCases.declareScopes(squadrons, {
        namespace: "squadrons",
        scopes: [],
      }),
    ).resolves.toMatchObject({ isOk: false, error: { kind: "SCOPE_HELD" } });
    await expect(
      core.useCases.listScopes(argo()).then((listed) => listed.at(-1)?.scopes),
    ).resolves.toEqual([FORM]);
  });

  it("go with their fleet when it is deleted", async () => {
    const squadrons = await plugin("squadrons");
    unwrap(
      await core.useCases.declareScopes(squadrons, {
        namespace: "squadrons",
        scopes: [FORM],
      }),
    );

    unwrap(
      await core.useCases.deleteFleet({
        requestId: "delete-home-fleet",
        fleetId,
      }),
    );

    await expect(core.prisma.scopeNamespace.count()).resolves.toBe(0);
  });
});

describe("granting scopes on Postgres", () => {
  const FORM = {
    scope: "squadrons:form",
    description: "Form a squadron by message",
  };
  const SCALE = {
    scope: "squadrons:scale",
    description: "Add and remove members",
  };

  it("stores the ship's new scopes and writes ScopesChanged in the same transaction, and the crew holds them at its next call", async () => {
    const { shipId, crewToken } = await claimedScout();

    unwrap(
      await core.useCases.grantScopes(argo(), {
        shipId,
        grant: ["fleet:read"],
        revoke: [],
      }),
    );

    await expect(
      core.prisma.ship.findUniqueOrThrow({
        where: { id: shipId },
        select: { scopes: true },
      }),
    ).resolves.toEqual({
      scopes: ["messages:send", "messages:receive", "fleet:read"],
    });
    await expect(
      core.prisma.event.findMany({
        where: { type: "ScopesChanged" },
        select: { shipId: true, actorShipId: true, details: true },
      }),
    ).resolves.toEqual([
      {
        shipId,
        actorShipId: argoId,
        details: { added: "fleet:read", removed: "" },
      },
    ]);
    await expect(
      core.useCases.authenticate.byCrewToken(crewToken),
    ).resolves.toMatchObject({
      isOk: true,
      value: { scopes: ["messages:send", "messages:receive", "fleet:read"] },
    });
  });

  it("lets a grant of a scope and a declaration removing it take turns: the scope is either granted and kept, or removed and refused", async () => {
    const { shipId: declarerId } = unwrap(
      await core.useCases.commissionShip(argo(), {
        idempotencyKey: newKey(),
        name: "squadrons",
        type: "plugin",
      }),
    );
    const declarer = {
      shipId: declarerId,
      fleetId,
      kind: "agent" as const,
      scopes: ["messages:send", "messages:receive", "scopes:declare"],
    };
    unwrap(
      await core.useCases.declareScopes(declarer, {
        namespace: "squadrons",
        scopes: [FORM, SCALE],
      }),
    );
    const { shipId } = await claimedScout();

    const [granted, declared] = await Promise.all([
      core.useCases.grantScopes(argo(), {
        shipId,
        grant: ["squadrons:scale"],
        revoke: [],
      }),
      core.useCases.declareScopes(declarer, {
        namespace: "squadrons",
        scopes: [FORM],
      }),
    ]);

    const outcome = [
      granted.isOk ? "granted" : granted.error.kind,
      declared.isOk ? "declared" : declared.error.kind,
    ];
    expect([
      ["granted", "SCOPE_HELD"],
      ["SCOPE_NOT_DECLARED", "declared"],
    ]).toContainEqual(outcome);
    const { scopes } = await core.prisma.ship.findUniqueOrThrow({
      where: { id: shipId },
      select: { scopes: true },
    });
    expect(scopes.includes("squadrons:scale")).toBe(outcome[0] === "granted");
  });
});

describe("commissioning with plugin scopes on Postgres", () => {
  const FORM = {
    scope: "squadrons:form",
    description: "Form a squadron by message",
  };
  const SCALE = {
    scope: "squadrons:scale",
    description: "Add and remove members",
  };

  it("lets a commission with a scope and a declaration removing it take turns: the ship is either commissioned holding it, or refused", async () => {
    const { shipId: declarerId } = unwrap(
      await core.useCases.commissionShip(argo(), {
        idempotencyKey: newKey(),
        name: "squadrons",
        type: "plugin",
      }),
    );
    const declarer = {
      shipId: declarerId,
      fleetId,
      kind: "agent" as const,
      scopes: ["messages:send", "messages:receive", "scopes:declare"],
    };
    unwrap(
      await core.useCases.declareScopes(declarer, {
        namespace: "squadrons",
        scopes: [FORM, SCALE],
      }),
    );

    const [commissioned, declared] = await Promise.all([
      core.useCases.commissionShip(argo(), {
        idempotencyKey: newKey(),
        name: "scaler",
        type: "reviewer",
        scopes: ["squadrons:scale"],
      }),
      core.useCases.declareScopes(declarer, {
        namespace: "squadrons",
        scopes: [FORM],
      }),
    ]);

    const outcome = [
      commissioned.isOk ? "commissioned" : commissioned.error.kind,
      declared.isOk ? "declared" : declared.error.kind,
    ];
    expect([
      ["commissioned", "SCOPE_HELD"],
      ["SCOPE_NOT_DECLARED", "declared"],
    ]).toContainEqual(outcome);
    const ships = await core.prisma.ship.findMany({
      where: { fleetId, name: "scaler" },
      select: { scopes: true },
    });
    expect(ships.map(({ scopes }) => scopes)).toEqual(
      outcome[0] === "commissioned"
        ? [["messages:send", "messages:receive", "squadrons:scale"]]
        : [],
    );
  });
});

describe("commissioning on behalf of the asking ship on Postgres (design on-behalf-scopes)", () => {
  it("never gives the new ship a scope the asking ship has lost: a revoke waits for the commission that read the scope, and lands after it", async () => {
    const { shipId: askingId } = unwrap(
      await core.useCases.commissionShip(argo(), {
        idempotencyKey: newKey(),
        name: "lead",
        type: "lead",
        scopes: ["fleet:read"],
      }),
    );
    const { shipId: squadronsId } = unwrap(
      await core.useCases.commissionShip(argo(), {
        idempotencyKey: newKey(),
        name: "squadrons",
        type: "plugin",
        scopes: ["fleet:commission", "fleet:on-behalf"],
      }),
    );
    const squadrons = {
      shipId: squadronsId,
      fleetId,
      kind: "agent" as const,
      scopes: [
        "messages:send",
        "messages:receive",
        "fleet:commission",
        "fleet:on-behalf",
      ],
    };
    const { uow, reached } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      ships: {
        ...tx.ships,
        lockName: async (shipFleetId, name) => {
          // The asking ship and its scopes are read; the commission holds here, before it locks a namespace, until a revoke waits for the asking ship.
          await hold();
          await tx.ships.lockName(shipFleetId, name);
        },
      },
    }));
    const commission = createCommissionShip({
      uow,
      clock: core.clock,
      ids: createIdGenerator(),
      secrets: { hasher: sha256Hasher, random: cryptoRandomTokens },
    });
    const steps: string[] = [];

    const commissioning = commission(squadrons, {
      idempotencyKey: newKey(),
      name: "login-flow",
      type: "flagship",
      ownerOf: askingId,
      scopes: ["fleet:read"],
    }).then((result) => {
      steps.push("commission stored");
      return result;
    });
    await reached;
    const revoking = core.useCases
      .grantScopes(argo(), {
        shipId: askingId,
        grant: [],
        revoke: ["fleet:read"],
      })
      .then((result) => {
        steps.push("revoke landed");
        return result;
      });
    await Promise.all([commissioning, revoking]);

    expect(steps).toEqual(["commission stored", "revoke landed"]);
    const { shipId } = unwrap(await commissioning);
    await expect(
      core.prisma.ship.findUniqueOrThrow({
        where: { id: shipId },
        select: { scopes: true },
      }),
    ).resolves.toEqual({
      scopes: ["messages:send", "messages:receive", "fleet:read"],
    });
    await expect(
      core.prisma.ship.findUniqueOrThrow({
        where: { id: askingId },
        select: { scopes: true },
      }),
    ).resolves.toEqual({ scopes: ["messages:send", "messages:receive"] });
  }, 20_000);
});

describe("retiring a namespace's declarer on Postgres", () => {
  const FORM = {
    scope: "squadrons:form",
    description: "Form a squadron by message",
  };

  it("frees the namespace and takes its scopes off every ship in the same transaction, while a grant of them takes its turn", async () => {
    const { shipId: declarerId } = unwrap(
      await core.useCases.commissionShip(argo(), {
        idempotencyKey: newKey(),
        name: "squadrons",
        type: "plugin",
      }),
    );
    const declarer = {
      shipId: declarerId,
      fleetId,
      kind: "agent" as const,
      scopes: ["messages:send", "messages:receive", "scopes:declare"],
    };
    unwrap(
      await core.useCases.declareScopes(declarer, {
        namespace: "squadrons",
        scopes: [FORM],
      }),
    );
    const { shipId } = await claimedScout();
    const { shipId: lookoutId } = unwrap(
      await core.useCases.commissionShip(argo(), {
        idempotencyKey: newKey(),
        name: "lookout",
        type: "reviewer",
      }),
    );
    unwrap(
      await core.useCases.grantScopes(argo(), {
        shipId,
        grant: ["squadrons:form"],
        revoke: [],
      }),
    );

    const [retired, granted] = await Promise.all([
      core.useCases.retireShip(argo(), { shipId: declarerId }),
      core.useCases.grantScopes(argo(), {
        shipId: lookoutId,
        grant: ["squadrons:form"],
        revoke: [],
      }),
    ]);

    expect(retired.isOk).toBe(true);
    expect(["granted", "SCOPE_NOT_DECLARED"]).toContain(
      granted.isOk ? "granted" : granted.error.kind,
    );
    await expect(core.prisma.scopeNamespace.count()).resolves.toBe(0);
    await expect(
      core.prisma.ship.findMany({
        where: { id: { in: [shipId, lookoutId] } },
        select: { scopes: true },
      }),
    ).resolves.toEqual([
      { scopes: ["messages:send", "messages:receive"] },
      { scopes: ["messages:send", "messages:receive"] },
    ]);
  });
});

describe("the fleet's own scopes on Postgres (design gateway-scopes, 4.1)", () => {
  const READ_LEADS = {
    scope: "crm:read-leads",
    description: "Read leads in the CRM",
  };

  /** A commissioned plugin ship as the caller its crew token resolves to. */
  async function plugin(name: string) {
    const { shipId } = unwrap(
      await core.useCases.commissionShip(argo(), {
        idempotencyKey: newKey(),
        name,
        type: "plugin",
      }),
    );
    return {
      shipId,
      fleetId,
      kind: "agent" as const,
      scopes: ["messages:send", "messages:receive", "scopes:declare"],
    };
  }

  it("keeps each change with its event in the same transaction: defined, described, removed", async () => {
    unwrap(await core.useCases.defineScope(argo(), READ_LEADS));
    await expect(
      core.prisma.definedScope.findMany({
        select: { fleetId: true, scope: true, description: true },
      }),
    ).resolves.toEqual([{ fleetId, ...READ_LEADS }]);

    unwrap(
      await core.useCases.describeScope(argo(), {
        scope: "crm:read-leads",
        description: "Read every lead",
      }),
    );
    await expect(
      core.useCases.listScopes(argo()).then((listed) => listed.at(-1)),
    ).resolves.toEqual({
      namespace: "crm",
      kind: "fleet",
      declaredBy: null,
      scopes: [{ scope: "crm:read-leads", description: "Read every lead" }],
    });

    unwrap(
      await core.useCases.removeScope(argo(), { scope: "crm:read-leads" }),
    );
    await expect(core.prisma.definedScope.count()).resolves.toBe(0);
    await expect(
      core.prisma.event.findMany({
        where: {
          type: { in: ["ScopeDefined", "ScopeDescribed", "ScopeRemoved"] },
        },
        orderBy: { seq: "asc" },
        select: { type: true, actorShipId: true, shipId: true, details: true },
      }),
    ).resolves.toEqual([
      {
        type: "ScopeDefined",
        actorShipId: argoId,
        shipId: null,
        details: READ_LEADS,
      },
      {
        type: "ScopeDescribed",
        actorShipId: argoId,
        shipId: null,
        details: { scope: "crm:read-leads", description: "Read every lead" },
      },
      {
        type: "ScopeRemoved",
        actorShipId: argoId,
        shipId: null,
        details: { scope: "crm:read-leads" },
      },
    ]);
  });

  it("gives a namespace to one of a define and a plugin's declare racing for it, never to both", async () => {
    const namespaces = [
      "crm",
      "vault",
      "finance",
      "payroll",
      "notes",
      "leads",
      "books",
      "tickets",
    ];
    const declarers = await Promise.all(
      namespaces.map((namespace) => plugin(`${namespace}-plugin`)),
    );

    const raced = await Promise.all(
      namespaces.map(async (namespace, at) => {
        const [defined, declared] = await Promise.all([
          core.useCases.defineScope(argo(), {
            scope: `${namespace}:read`,
            description: "Read",
          }),
          core.useCases.declareScopes(declarers[at] ?? argo(), {
            namespace,
            scopes: [],
          }),
        ]);
        return [
          defined.isOk ? "defined" : defined.error.kind,
          declared.isOk ? "declared" : declared.error.kind,
        ];
      }),
    );

    for (const outcome of raced) {
      expect([
        ["defined", "NAMESPACE_TAKEN"],
        ["NAMESPACE_TAKEN", "declared"],
      ]).toContainEqual(outcome);
    }
    const listed = (await core.useCases.listScopes(argo())).slice(6);
    expect(listed.map(({ namespace }) => namespace).toSorted()).toEqual(
      namespaces.toSorted(),
    );
    expect(
      listed.map(({ namespace, kind }) => [namespace, kind]).toSorted(),
    ).toEqual(
      namespaces
        .map((namespace, at) => [
          namespace,
          raced[at]?.[0] === "defined" ? "fleet" : "plugin",
        ])
        .toSorted(),
    );
  });

  it("lets a grant of a scope and its removal take turns: the scope is either granted and kept, or removed and refused", async () => {
    unwrap(await core.useCases.defineScope(argo(), READ_LEADS));
    const { shipId } = await claimedScout();

    const [granted, removed] = await Promise.all([
      core.useCases.grantScopes(argo(), {
        shipId,
        grant: ["crm:read-leads"],
        revoke: [],
      }),
      core.useCases.removeScope(argo(), { scope: "crm:read-leads" }),
    ]);

    const outcome = [
      granted.isOk ? "granted" : granted.error.kind,
      removed.isOk ? "removed" : removed.error.kind,
    ];
    expect([
      ["granted", "SCOPE_HELD"],
      ["SCOPE_NOT_DECLARED", "removed"],
    ]).toContainEqual(outcome);
    await expect(core.prisma.definedScope.count()).resolves.toBe(
      outcome[0] === "granted" ? 1 : 0,
    );
  });

  it("counts only active ships as holding a scope, by the ships table", async () => {
    unwrap(await core.useCases.defineScope(argo(), READ_LEADS));
    const { shipId } = await claimedScout();
    unwrap(
      await core.useCases.grantScopes(argo(), {
        shipId,
        grant: ["crm:read-leads"],
        revoke: [],
      }),
    );

    await expect(
      core.useCases.removeScope(argo(), { scope: "crm:read-leads" }),
    ).resolves.toMatchObject({
      isOk: false,
      error: {
        kind: "SCOPE_HELD",
        message: "1 ship holds crm:read-leads: revoke it from it first",
      },
    });
    unwrap(await core.useCases.retireShip(argo(), { shipId }));
    await expect(
      core.useCases.removeScope(argo(), { scope: "crm:read-leads" }),
    ).resolves.toMatchObject({ isOk: true });
  });

  it("refuses a scope row of no scope shape", async () => {
    await expect(
      core.prisma.definedScope.create({
        data: { fleetId, scope: "CRM:read", description: "Read" },
      }),
    ).rejects.toThrow(/defined_scopes_scope_check/);
  });

  it("go with their fleet when it is deleted", async () => {
    unwrap(await core.useCases.defineScope(argo(), READ_LEADS));

    unwrap(
      await core.useCases.deleteFleet({
        requestId: "delete-home-fleet",
        fleetId,
      }),
    );

    await expect(core.prisma.definedScope.count()).resolves.toBe(0);
  });
});
