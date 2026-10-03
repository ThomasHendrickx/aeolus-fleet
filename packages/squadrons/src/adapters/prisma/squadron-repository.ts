import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { BlueprintVersion, TemplateVersion } from '../../core/catalogue/catalogue.js';
import type { SquadronRepository } from '../../core/squadron/ports.js';
import type { Squadron } from '../../core/squadron/squadron.js';
import type { Db, PrismaClient } from './client.js';

const reference = z.object({ repository: z.string(), name: z.string(), version: z.number() });
const templatesSchema: z.ZodType<TemplateVersion[]> = z.array(
  z.object({
    repository: z.string(),
    name: z.string(),
    version: z.number(),
    commit: z.string(),
    committedAt: z.coerce.date(),
    description: z.string(),
    checkInMinutes: z.number(),
    launchNote: z.string().nullable(),
    charter: z.string(),
    handoffs: z.array(z.object({ name: z.string(), carries: z.string() })),
  }),
);
const blueprintSchema: z.ZodType<BlueprintVersion> = z.object({
  repository: z.string(),
  name: z.string(),
  version: z.number(),
  commit: z.string(),
  committedAt: z.coerce.date(),
  description: z.string(),
  roles: z.array(z.object({ name: z.string(), template: reference, count: z.number() })),
  handoffs: z.array(z.object({ role: z.string(), handoff: z.string(), to: z.string() })),
  entry: z.string(),
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
      })),
    formedAt: row.formedAt,
    sailedAt: row.sailedAt,
  };
}

export function createPrismaSquadronRepository(db: Db): SquadronRepository {
  return {
    exists: async (fleetId, id) => (await db.squadron.count({ where: { fleetId, id } })) > 0,
    create: async (squadron) => {
      await db.squadron.create({
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
            })),
          },
        },
      });
    },
    list: async (fleetId) =>
      (await db.squadron.findMany({ where: { fleetId }, include: { members: true }, orderBy: { formedAt: 'asc' } })).map(squadronOf),
  };
}
