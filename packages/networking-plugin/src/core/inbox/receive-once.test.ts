import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, connectedCrew, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { createReceiveOnce } from './receive-once.js';

let fleet: ReturnType<typeof fakePluginFleet>;
let connections: ReturnType<typeof memoryConnectionStore>;
let receiveOnce: ReturnType<typeof createReceiveOnce>;

beforeEach(() => {
  fleet = fakePluginFleet();
  connections = memoryConnectionStore();
  receiveOnce = createReceiveOnce({ door: fleet.door, connections });
});

describe("the networking plugin's ship receiving", () => {
  it('acknowledges every delivery waiting for it and acts on none: a ship acknowledges on receipt', async () => {
    await connectedCrew(fleet, connections);
    fleet.state.waiting = ['dlv_01m3tbfspe96yf1rnr4ank9001', 'dlv_01m3tbfspe96yf1rnr4ank9002'];

    await expect(receiveOnce(FLEET_ID)).resolves.toEqual({ isOk: true, value: { acknowledged: 2 } });
    expect(fleet.state.acked).toEqual(['dlv_01m3tbfspe96yf1rnr4ank9001', 'dlv_01m3tbfspe96yf1rnr4ank9002']);
    expect(fleet.state.waiting).toEqual([]);
    expect(fleet.state.version).toBe(0);
  });

  it("answers argo's ping with pong, not a plain ack, and acknowledges the rest", async () => {
    await connectedCrew(fleet, connections);
    fleet.state.waiting = ['dlv_01m3tbfspe96yf1rnr4ank9001', 'dlv_01m3tbfspe96yf1rnr4ank9002'];
    fleet.state.pings.add('dlv_01m3tbfspe96yf1rnr4ank9002');

    await expect(receiveOnce(FLEET_ID)).resolves.toEqual({ isOk: true, value: { acknowledged: 2 } });
    expect(fleet.state.ponged).toEqual(['dlv_01m3tbfspe96yf1rnr4ank9002']);
    expect(fleet.state.acked).toEqual(['dlv_01m3tbfspe96yf1rnr4ank9001']);
    expect(fleet.state.waiting).toEqual([]);
  });

  it('is refused while the fleet does not take the pong', async () => {
    await connectedCrew(fleet, connections);
    fleet.state.waiting = ['dlv_01m3tbfspe96yf1rnr4ank9001'];
    fleet.state.pings.add('dlv_01m3tbfspe96yf1rnr4ank9001');
    fleet.state.isTakingPongs = false;

    await expect(receiveOnce(FLEET_ID)).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
    expect(fleet.state.acked).toEqual([]);
  });

  it('receives nothing for a fleet it is not connected to', async () => {
    await expect(receiveOnce(FLEET_ID)).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
  });

  it('drops a crew token the fleet no longer takes: not connected until argo connects it again', async () => {
    await connectedCrew(fleet, connections);
    fleet.state.liveTokens.clear();

    await expect(receiveOnce(FLEET_ID)).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
    await expect(connections.find(FLEET_ID)).resolves.toBeUndefined();
  });

  it('is refused while the fleet does not answer, keeping the crew token', async () => {
    await connectedCrew(fleet, connections);
    fleet.state.isAnswering = false;

    await expect(receiveOnce(FLEET_ID)).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
    await expect(connections.find(FLEET_ID)).resolves.toBeDefined();
  });
});
