import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { idSchema, NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MAX_SECONDS, SAME_LABEL_VALUE } from '@aeolus-fleet/common';
import { z } from 'zod';

import { createApp, createMigratedDatabase, createPrismaClient, createUseCases, FLEET_URL, newKey, OPERATOR, operatorCaller, secretOf, unwrap, type PrismaClient } from '@aeolus-fleet/core/testing';

import { createSquadronsApp, type SquadronsApp } from '../src/app.js';
import { createSquadronsDatabase } from '../src/testing/database.js';
import { startFakeGithub, tagsAt, type FakeGithub } from '../src/testing/fake-github.js';
import { seedRepository } from '../src/testing/repositories.js';

// A ship forming a squadron by message against a real fleet (decision 0017):
// squadrons declares its namespace, argo grants a tech lead squadrons:form,
// the tech lead forms a squadron from a blueprint, its member relays a
// question through the flagship and gets the answer, and the tech lead stands
// the squadron down.

const REPO = 'github.com/acme/templates';
const FORM = 'application/vnd.aeolus.squadron.form+json';
const FORMED = 'application/vnd.aeolus.squadron.formed+json';
const RELAY = 'application/vnd.aeolus.squadron.relay+json';
const STANDING_DOWN = 'application/vnd.aeolus.squadron.standing-down+json';
const CHECK_IN = 'application/vnd.aeolus.squadron.check-in+json';
const ROLE = 'application/vnd.aeolus.squadron.role+json';
const ON_STATION = 'application/vnd.aeolus.squadron.on-station+json';
const STAND_DOWN = 'application/vnd.aeolus.squadron.stand-down+json';
const REFUSED = 'application/vnd.aeolus.squadron.refused+json';
const ADD_MEMBER = 'application/vnd.aeolus.squadron.add-member+json';
const MEMBER_ADDED = 'application/vnd.aeolus.squadron.member-added+json';
const REMOVE_MEMBER = 'application/vnd.aeolus.squadron.remove-member+json';
const MEMBER_REMOVED = 'application/vnd.aeolus.squadron.member-removed+json';
/** A live change shows within this. */
const LIVE_TIMEOUT_MS = 20_000;

let github: FakeGithub;
let fleetDatabase: PrismaClient;
let fleet: FastifyInstance;
let fleetUrl: string;
let app: SquadronsApp;
let address: string;
let cookie: string;
let fleetUseCases: ReturnType<typeof createUseCases>;
let argo: ReturnType<typeof operatorCaller>;

async function signIn(): Promise<string> {
  const response = await fetch(`${fleetUrl}/trpc/console.signIn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: new URL(FLEET_URL).origin },
    body: JSON.stringify({ email: OPERATOR.email, password: OPERATOR.password }),
  });
  const set = response.headers.getSetCookie().find((each) => each.startsWith('aeolus_session='));
  return z.string().parse(set).split(';')[0] ?? '';
}

beforeEach(async () => {
  github = await startFakeGithub();
  github.repositories.set('acme/templates', {
    tags: tagsAt(
      {
        files: {
          '.aeolus/squadrons/templates/builder.yaml': 'description: Builds.\ncheckIn: 30m\ncharter: You build {{area}}.\nparameters:\n  area: What to build\ncrew:\n  workspace:\n    kind: worktree\n    repository: hemma\n',
          '.aeolus/squadrons/blueprints/delivery.yaml': `description: Delivers one outcome.\nroles:\n  builder:\n    template: ${REPO}#builder@1\n`,
        },
      },
      'builder@1', 'delivery@1',
    ),
  });

  const fleetDatabaseUrl = await createMigratedDatabase();
  fleetDatabase = createPrismaClient(fleetDatabaseUrl);
  fleetUseCases = createUseCases({ prisma: fleetDatabase });
  argo = operatorCaller(unwrap(await fleetUseCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  const { shipId, secret } = unwrap(
    await fleetUseCases.commissionShip(argo, {
      idempotencyKey: newKey(),
      name: 'squadrons',
      type: 'squadrons',
      scopes: ['fleet:read', 'fleet:commission', 'fleet:manage', 'labels:define', 'labels:assign', 'fleet:on-behalf', 'scopes:declare'],
    }),
  );
  fleet = createApp({ databaseUrl: fleetDatabaseUrl, publicUrl: FLEET_URL, logger: false, receiveWaitMs: 500 });
  fleetUrl = await fleet.listen({ host: '127.0.0.1', port: 0 });

  const squadronsDatabaseUrl = await createSquadronsDatabase();
  await seedRepository(squadronsDatabaseUrl, { fleetId: argo.fleetId, name: REPO, url: 'https://github.com/acme/templates' });
  app = createSquadronsApp({ databaseUrl: squadronsDatabaseUrl, fleetUrl, githubApiUrl: github.apiUrl, logger: false });
  unwrap(await app.connect({ operatorFleetId: argo.fleetId, shipId, secret: secretOf(secret) }));
  await app.refreshCatalogue();
  address = await app.server.listen({ host: '127.0.0.1', port: 0 });
  app.startFlagships(200);
  cookie = await signIn();
});

afterEach(async () => {
  await app.close();
  await fleet.close();
  await fleetDatabase.$disconnect();
  await github.close();
});

const deliveriesSchema = z.object({
  deliveries: z.array(z.object({ deliveryId: z.string(), messageId: z.string(), contentType: z.string(), payload: z.string(), inReplyTo: z.string().nullable() })),
});
type Delivery = z.infer<typeof deliveriesSchema>['deliveries'][number];

/** A ship's session over the fleet's REST API, crewed with its secret. */
async function crewed(ship: { shipId: string; secret: string }) {
  const registered = await fetch(`${fleetUrl}/api/v1/ship/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...ship, location: { kind: 'DEVICE' }, harness: 'claude-code' }),
  });
  const { crewToken } = z.object({ crewToken: z.string() }).parse(await registered.json());
  const call = async (operation: 'send' | 'receive' | 'ack', body: Record<string, unknown>): Promise<unknown> => {
    const response = await fetch(`${fleetUrl}/api/v1/ship/${operation}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` },
      body: JSON.stringify(operation === 'send' ? { model: 'claude-opus-5-5', ...body } : body),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return response.json();
  };
  /** Receives until a delivery of the content type arrives, acks it and answers it. */
  const awaitDelivery = async (contentType: string): Promise<Delivery> => {
    let found: Delivery | undefined;
    await expect
      .poll(
        async () => {
          const { deliveries } = deliveriesSchema.parse(await call('receive', {}));
          for (const delivery of deliveries) {
            await call('ack', { deliveryId: delivery.deliveryId });
          }
          found = deliveries.find((delivery) => delivery.contentType === contentType) ?? found;
          return found !== undefined;
        },
        { timeout: LIVE_TIMEOUT_MS },
      )
      .toBe(true);
    if (!found) {
      expect.fail(`no ${contentType} arrived`);
    }
    return found;
  };
  return { call, awaitDelivery };
}

async function squadronOf(squadronId: string) {
  const listed = z
    .object({ result: z.object({ data: z.array(z.object({ id: z.string(), state: z.string(), members: z.array(z.object({ shipId: z.string(), name: z.string() })) })) }) })
    .parse(await (await fetch(`${address}/trpc/squadrons.list`, { headers: { cookie } })).json());
  return listed.result.data.find((squadron) => squadron.id === squadronId);
}

describe('a ship holding squadrons:form (decision 0017)', () => {
  it('forms a squadron by message, hears from its member through the flagship, and stands the squadron down', async () => {
    await expect
      .poll(async () => (await fleetUseCases.listScopes(argo)).find((namespace) => namespace.namespace === 'squadrons')?.scopes.map((each) => each.scope), { timeout: LIVE_TIMEOUT_MS })
      .toEqual(['squadrons:form', 'squadrons:scale']);
    const lead = unwrap(await fleetUseCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'tech-lead', type: 'lead', scopes: ['squadrons:form'] }));
    const techLead = await crewed({ shipId: lead.shipId, secret: secretOf(lead.secret) });

    await techLead.call('send', {
      selector: { kind: 'ship', name: 'squadrons' },
      contentType: FORM,
      payload: JSON.stringify({ blueprint: `${REPO}#delivery@1`, squadronId: 'login-flow', members: { 'builder-1': { parameters: { area: 'the login flow' } } }, key: 'form-1' }),
      idempotencyKey: 'form-1',
    });
    const formed = await techLead.awaitDelivery(FORMED);
    expect(JSON.parse(formed.payload)).toEqual({ key: 'form-1', squadronId: 'login-flow', flagship: 'login-flow' });

    const memberShipId = idSchema('ship').parse((await squadronOf('login-flow'))?.members[0]?.shipId);
    const issued = unwrap(await fleetUseCases.getStartingPrompt(argo, { shipId: memberShipId }));
    const member = await crewed({ shipId: memberShipId, secret: issued.secret });
    await member.call('send', { selector: { kind: 'ship', name: 'login-flow' }, contentType: CHECK_IN, payload: JSON.stringify({ squadron: 'login-flow' }), idempotencyKey: 'check-in-1' });
    const role = await member.awaitDelivery(ROLE);
    expect(JSON.parse(role.payload)).toMatchObject({ charter: 'You build the login flow.' });
    await member.call('send', { selector: { kind: 'ship', name: 'login-flow' }, contentType: ON_STATION, payload: JSON.stringify({ squadron: 'login-flow', role: 'builder' }), inReplyTo: role.messageId, idempotencyKey: 'on-station-1' });
    await expect.poll(async () => (await squadronOf('login-flow'))?.state, { timeout: LIVE_TIMEOUT_MS }).toBe('sailing');

    await member.call('send', { selector: { kind: 'ship', name: 'login-flow' }, contentType: RELAY, payload: JSON.stringify({ squadron: 'login-flow', payload: 'Which branch?' }), idempotencyKey: 'relay-1' });
    const asked = await techLead.awaitDelivery(RELAY);
    expect(JSON.parse(asked.payload)).toMatchObject({ squadron: 'login-flow', member: { role: 'builder' }, payload: 'Which branch?' });
    await techLead.call('send', { selector: { kind: 'ship', name: 'login-flow' }, contentType: RELAY, payload: JSON.stringify({ squadron: 'login-flow', payload: 'main' }), inReplyTo: asked.messageId, idempotencyKey: 'relay-answer-1' });
    const answer = await member.awaitDelivery(RELAY);
    expect(JSON.parse(answer.payload)).toEqual({ squadron: 'login-flow', from: 'tech-lead', payload: 'main' });

    await techLead.call('send', { selector: { kind: 'ship', name: 'login-flow' }, contentType: STAND_DOWN, payload: JSON.stringify({ squadron: 'login-flow' }), idempotencyKey: 'stand-down-1' });
    await techLead.awaitDelivery(STANDING_DOWN);
    await member.awaitDelivery(STAND_DOWN);

    expect((await squadronOf('login-flow'))?.state).toBe('standing-down');
  });

  it("gives the squadron's ships the forming ship's owner, so an owner=# rule in force lets the flagship and the forming ship reach each other with open send off (decisions 0045, 0034)", async () => {
    const thomas = unwrap(await fleetUseCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' }));
    const lead = unwrap(await fleetUseCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'tech-lead', type: 'lead', scopes: ['squadrons:form'] }));
    unwrap(await fleetUseCases.setOwner(argo, { shipId: lead.shipId, ownerShipId: thomas.shipId }));
    const outsider = unwrap(await fleetUseCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'outsider', type: 'lead' }));
    const techLead = await crewed({ shipId: lead.shipId, secret: secretOf(lead.secret) });
    await techLead.call('send', {
      selector: { kind: 'ship', name: 'squadrons' },
      contentType: FORM,
      payload: JSON.stringify({ blueprint: `${REPO}#delivery@1`, squadronId: 'login-flow', members: { 'builder-1': { parameters: { area: 'the login flow' } } }, key: 'form-1' }),
      idempotencyKey: 'form-1',
    });
    await techLead.awaitDelivery(FORMED);
    const flagship = await fleetDatabase.ship.findFirstOrThrow({ where: { name: 'login-flow' }, select: { id: true, ownerShipId: true } });
    const flagshipId = idSchema('ship').parse(flagship.id);

    const plugin = unwrap(await fleetUseCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'networking', type: 'networking', scopes: ['fleet:network'] }));
    const { crewToken } = unwrap(await fleetUseCases.claimShip({ shipId: plugin.shipId, secret: secretOf(plugin.secret), location: { kind: 'CLOUD' }, harness: 'aeolus-networking-plugin' }));
    const networking = unwrap(await fleetUseCases.authenticate.byCrewToken(crewToken));
    unwrap(await fleetUseCases.registerNetworkPlugin(networking, { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MAX_SECONDS }));
    unwrap(await fleetUseCases.setNetworkRules(networking, { rules: [{ verb: 'send', from: [{ owner: SAME_LABEL_VALUE }], to: [{ owner: SAME_LABEL_VALUE }] }] }));
    unwrap(await fleetUseCases.setBuiltInRule(networking, { rule: 'open', verb: 'send', isOn: false }));

    expect(flagship.ownerShipId).toBe(thomas.shipId);
    const toFlagship = unwrap(await fleetUseCases.explainReach(argo, { fromShipId: lead.shipId, toShipId: flagshipId }));
    const toLead = unwrap(await fleetUseCases.explainReach(argo, { fromShipId: flagshipId, toShipId: lead.shipId }));
    const fromOutsider = unwrap(await fleetUseCases.explainReach(argo, { fromShipId: outsider.shipId, toShipId: flagshipId }));
    expect([toFlagship.send.map(({ shipId }) => shipId), toLead.send.map(({ shipId }) => shipId), fromOutsider.send]).toEqual([[flagshipId], [lead.shipId], []]);
  });

  /** The tech lead's form request for login-flow, answered formed. */
  async function formLoginFlow(techLead: Awaited<ReturnType<typeof crewed>>): Promise<void> {
    await techLead.call('send', {
      selector: { kind: 'ship', name: 'squadrons' },
      contentType: FORM,
      payload: JSON.stringify({ blueprint: `${REPO}#delivery@1`, squadronId: 'login-flow', members: { 'builder-1': { parameters: { area: 'the login flow' } } }, key: 'form-1' }),
      idempotencyKey: 'form-1',
    });
    await techLead.awaitDelivery(FORMED);
  }

  /** login-flow's member checks in and comes on station, so the squadron sails. */
  async function sail(): Promise<void> {
    const memberShipId = idSchema('ship').parse((await squadronOf('login-flow'))?.members[0]?.shipId);
    const member = await crewed({ shipId: memberShipId, secret: unwrap(await fleetUseCases.getStartingPrompt(argo, { shipId: memberShipId })).secret });
    await member.call('send', { selector: { kind: 'ship', name: 'login-flow' }, contentType: CHECK_IN, payload: JSON.stringify({ squadron: 'login-flow' }), idempotencyKey: 'check-in-1' });
    const role = await member.awaitDelivery(ROLE);
    await member.call('send', { selector: { kind: 'ship', name: 'login-flow' }, contentType: ON_STATION, payload: JSON.stringify({ squadron: 'login-flow', role: 'builder' }), inReplyTo: role.messageId, idempotencyKey: 'on-station-1' });
    await expect.poll(async () => (await squadronOf('login-flow'))?.state, { timeout: LIVE_TIMEOUT_MS }).toBe('sailing');
  }

  it('adds and removes a member by message for a ship holding squadrons:scale, and refuses it without the scope', async () => {
    const lead = unwrap(await fleetUseCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'tech-lead', type: 'lead', scopes: ['squadrons:form'] }));
    const techLead = await crewed({ shipId: lead.shipId, secret: secretOf(lead.secret) });
    await formLoginFlow(techLead);
    await sail();
    const addBuilder = { selector: { kind: 'ship', name: 'login-flow' }, contentType: ADD_MEMBER, payload: JSON.stringify({ squadron: 'login-flow', role: 'builder', parameters: { area: 'the signup flow' }, key: 'add-1' }) };

    await techLead.call('send', { ...addBuilder, idempotencyKey: 'add-1' });
    const refused = await techLead.awaitDelivery(REFUSED);
    unwrap(await fleetUseCases.grantScopes(argo, { shipId: lead.shipId, grant: ['squadrons:scale'], revoke: [] }));
    await techLead.call('send', { ...addBuilder, idempotencyKey: 'add-2' });
    const added = await techLead.awaitDelivery(MEMBER_ADDED);
    const { member } = z.object({ member: z.object({ name: z.string(), role: z.string() }) }).parse(JSON.parse(added.payload));
    await techLead.call('send', { selector: { kind: 'ship', name: 'login-flow' }, contentType: REMOVE_MEMBER, payload: JSON.stringify({ squadron: 'login-flow', member: member.name }), idempotencyKey: 'remove-1' });
    await techLead.awaitDelivery(MEMBER_REMOVED);

    expect(JSON.parse(refused.payload)).toMatchObject({ squadron: 'login-flow', code: 'NEEDS_SCOPE' });
    expect(member.role).toBe('builder');
    expect((await squadronOf('login-flow'))?.members.map(({ name }) => name)).toEqual([expect.any(String), member.name]);
    const removed = await fleetDatabase.ship.findFirstOrThrow({ where: { name: member.name }, select: { id: true } });
    await expect(fleetDatabase.crewRequest.count({ where: { shipId: removed.id } })).resolves.toBe(0);
  });

  it("sends a member's relay to the forming ship's owner once the forming ship is retired (0.R)", async () => {
    const thomas = unwrap(await fleetUseCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' }));
    const lead = unwrap(await fleetUseCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'tech-lead', type: 'lead', scopes: ['squadrons:form'] }));
    unwrap(await fleetUseCases.setOwner(argo, { shipId: lead.shipId, ownerShipId: thomas.shipId }));
    const techLead = await crewed({ shipId: lead.shipId, secret: secretOf(lead.secret) });
    await formLoginFlow(techLead);
    const memberShipId = idSchema('ship').parse((await squadronOf('login-flow'))?.members[0]?.shipId);
    const member = await crewed({ shipId: memberShipId, secret: unwrap(await fleetUseCases.getStartingPrompt(argo, { shipId: memberShipId })).secret });
    unwrap(await fleetUseCases.retireShip(argo, { shipId: lead.shipId }));
    const owner = await crewed({ shipId: thomas.shipId, secret: secretOf(thomas.secret) });

    await member.call('send', { selector: { kind: 'ship', name: 'login-flow' }, contentType: RELAY, payload: JSON.stringify({ squadron: 'login-flow', payload: 'Which branch?' }), idempotencyKey: 'relay-1' });
    const asked = await owner.awaitDelivery(RELAY);

    expect(JSON.parse(asked.payload)).toMatchObject({ squadron: 'login-flow', member: { role: 'builder' }, payload: 'Which branch?' });
  });
});
