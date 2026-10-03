import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { BlueprintVersion, TemplateVersion } from '../../core/catalogue/catalogue.js';
import type { SquadronRepository } from '../../core/squadron/ports.js';
import type { Member, Squadron } from '../../core/squadron/squadron.js';
import type { PrismaClient } from './client.js';

const reference = z.object({ repository: z.string(), name: z.string(), version: z.number() });
const templatesSchema: z.ZodType<TemplateVersion[]> = z.array(
  z.object({
    repository: z.string(),
    name: z.string(),
    version: z.number(),
    // Snapshots stored before versions kept their file have none.
    file: z.string().default(''),
    commit: z.string(),
    committedAt: z.coerce.date(),
    description: z.string(),
    checkInMinutes: z.number(),
    model: z.string().nullable(),
    launchNote: z.string().nullable(),
    charter: z.string(),
    handoffs: z.array(z.object({ name: z.string(), carries: z.string() })),
  }),
);
const blueprintSchema: z.ZodType<BlueprintVersion> = z.object({
  repository: z.string(),
  name: z.string(),
  version: z.number(),
  file: z.string().default(''),
  commit: z.string(),
  committedAt: z.coerce.date(),
  description: z.string(),
  roles: z.array(z.object({ name: z.string(), template: reference, count: z.number() })),
  handoffs: z.array(z.object({ role: z.string(), handoff: z.string(), to: z.string() })),
  memberNames: z.enum(['plain', 'prefixed']),
});
const stateSchema = z.enum(['forming', 'sailing', 'standing-down', 'disbanded']);

type Row = NonNullable<Awaited<ReturnType<PrismaClient['squadron']['findFirst']>>> & {
  members: NonNullable<Awaited<ReturnType<PrismaClient['member']['findFirst']>>>[];
};

function squadronOf(row: Row): Squadron {
  return {
    id: row.id,
    fleetId: idSchema('fleet').parse(row.fleetId),
    state: stateSchema.parse(row.state),
    blueprint: blueprintSchema.parse(row.blueprint),
    templates: templatesSchema.parse(row.templates),
    flagship: { shipId: idSchema('ship').parse(row.flagshipShipId), name: row.flagshipName, crewToken: row.flagshipCrewToken },
    members: row.members
      .sort((first, second) => first.position - second.position)
      .map((member) => ({
        shipId: idSchema('ship').parse(member.shipId),
        name: member.name,
        role: member.role,
        type: member.type,
        onStationAt: member.onStationAt,
        checkIn: member.checkInAt === null ? null : { at: member.checkInAt, model: member.checkInModel },
        standDownMessageId: member.standDownMessageId === null ? null : idSchema('message').parse(member.standDownMessageId),
        stoodDownAt: member.stoodDownAt,
        retiredAt: member.retiredAt,
      })),
    formedAt: row.formedAt,
    sailedAt: row.sailedAt,
  };
}

function isSameCheckIn(first: Member['checkIn'], second: Member['checkIn']): boolean {
  return first?.at.getTime() === second?.at.getTime() && first?.model === second?.model;
}

export function createPrismaSquadronRepository(db: PrismaClient, clock: { now(): Date }): SquadronRepository {
  return {
    exists: async (fleetId, id) => (await db.squadron.count({ where: { fleetId, id } })) > 0,
    create: async (squadron, attemptId) => {
      const create = db.squadron.create({
        data: {
          fleetId: squadron.fleetId,
          id: squadron.id,
          state: squadron.state,
          // JSON keeps the times as ISO strings; reading parses them back.
          blueprint: z.record(z.string(), z.json()).parse(JSON.parse(JSON.stringify(squadron.blueprint))),
          templates: z.array(z.json()).parse(JSON.parse(JSON.stringify(squadron.templates))),
          flagshipShipId: squadron.flagship.shipId,
          flagshipName: squadron.flagship.name,
          flagshipCrewToken: squadron.flagship.crewToken,
          formedAt: squadron.formedAt,
          sailedAt: squadron.sailedAt,
          members: {
            // Each member's fleet comes from its squadron, through the relation.
            create: squadron.members.map((member, position) => ({
              shipId: member.shipId,
              position,
              name: member.name,
              role: member.role,
              type: member.type,
              onStationAt: member.onStationAt,
              checkInAt: member.checkIn?.at ?? null,
              checkInModel: member.checkIn?.model ?? null,
              standDownMessageId: member.standDownMessageId,
              stoodDownAt: member.stoodDownAt,
              retiredAt: member.retiredAt,
            })),
          },
        },
      });
      // The squadron and the end of its attempt commit together: a crash leaves both or neither.
      await db.$transaction([create, db.formationAttempt.updateMany({ where: { id: attemptId, finishedAt: null }, data: { finishedAt: clock.now() } })]);
    },
    update: async ({ before, after, finishesAttempt }) => {
      const { fleetId, id } = after;
      const writes = [];
      if (after.state !== before.state || after.sailedAt?.getTime() !== before.sailedAt?.getTime()) {
        writes.push(db.squadron.updateMany({ where: { fleetId, id }, data: { state: after.state, sailedAt: after.sailedAt } }));
      }
      for (const [position, member] of after.members.entries()) {
        const was = before.members.find((each) => each.shipId === member.shipId);
        if (!was) {
          writes.push(
            db.member.create({
              data: {
                fleetId,
                squadronId: id,
                shipId: member.shipId,
                position,
                name: member.name,
                role: member.role,
                type: member.type,
                onStationAt: member.onStationAt,
                checkInAt: member.checkIn?.at ?? null,
                checkInModel: member.checkIn?.model ?? null,
                standDownMessageId: member.standDownMessageId,
                stoodDownAt: member.stoodDownAt,
                retiredAt: member.retiredAt,
              },
            }),
          );
          continue;
        }
        const data = {
          ...(member.onStationAt?.getTime() === was.onStationAt?.getTime() ? {} : { onStationAt: member.onStationAt }),
          ...(isSameCheckIn(member.checkIn, was.checkIn ?? null) ? {} : { checkInAt: member.checkIn?.at ?? null, checkInModel: member.checkIn?.model ?? null }),
          ...(member.standDownMessageId === was.standDownMessageId ? {} : { standDownMessageId: member.standDownMessageId }),
          ...(member.stoodDownAt?.getTime() === was.stoodDownAt?.getTime() ? {} : { stoodDownAt: member.stoodDownAt }),
          ...(member.retiredAt?.getTime() === was.retiredAt?.getTime() ? {} : { retiredAt: member.retiredAt }),
        };
        if (Object.keys(data).length > 0) {
          writes.push(db.member.updateMany({ where: { fleetId, shipId: member.shipId }, data }));
        }
      }
      if (finishesAttempt !== undefined) {
        writes.push(db.formationAttempt.updateMany({ where: { id: finishesAttempt, finishedAt: null }, data: { finishedAt: clock.now() } }));
      }
      await db.$transaction(writes);
    },
    list: async (fleetId) =>
      (await db.squadron.findMany({ where: { fleetId }, include: { members: true }, orderBy: { formedAt: 'asc' } })).map(squadronOf),
  };
}
