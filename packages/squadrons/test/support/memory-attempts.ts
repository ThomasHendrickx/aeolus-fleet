import type { FormationAttempt, FormationAttempts } from '../../src/core/squadron/ports.js';

/** Formation attempts in memory, finished when the squadron is created with them. */
export function memoryAttempts(): FormationAttempts & { held: (FormationAttempt & { isFinished: boolean })[] } {
  const attempts: FormationAttempts & { held: (FormationAttempt & { isFinished: boolean })[] } = {
    held: [],
    begin: (attempt) => {
      attempts.held.push({ ...attempt, ships: [], isFinished: false });
      return Promise.resolve();
    },
    plan: (attemptId, name) => {
      attempts.held.find((held) => held.id === attemptId)?.ships.push({ name, shipId: null });
      return Promise.resolve();
    },
    commissioned: (attemptId, ship) => {
      const planned = attempts.held.find((held) => held.id === attemptId)?.ships.find((each) => each.name === ship.name);
      if (planned) {
        planned.shipId = ship.shipId;
      }
      return Promise.resolve();
    },
    finish: (attemptId) => {
      const held = attempts.held.find((each) => each.id === attemptId);
      if (held) {
        held.isFinished = true;
      }
      return Promise.resolve();
    },
    unfinished: (fleetId) => Promise.resolve(attempts.held.filter((held) => held.fleetId === fleetId && !held.isFinished)),
  };
  return attempts;
}
