import { accountIdSchema, idSchema, verifiedFactSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { VerifiedFactsRepository } from '../../domain/registry/ports.js';
import type { FactWriter, WrittenFacts } from '../../domain/registry/verified-facts.js';
import type { Db } from './client.js';

/** The columns that name a writer; the installation, which has no id, by its name. */
function writerColumns(writer: FactWriter): { writerKind: FactWriter['kind']; writer: string } {
  switch (writer.kind) {
    case 'ship':
      return { writerKind: writer.kind, writer: writer.shipId };
    case 'account':
      return { writerKind: writer.kind, writer: writer.accountId };
    case 'installation':
      return { writerKind: writer.kind, writer: 'installation' };
  }
}

/** The writer from its two columns. */
function writerOf(kind: FactWriter['kind'], writer: string): FactWriter {
  switch (kind) {
    case 'ship':
      return { kind, shipId: idSchema('ship').parse(writer) };
    case 'account':
      return { kind, accountId: accountIdSchema.parse(writer) };
    case 'installation':
      return { kind };
  }
}

const factsSchema = z.array(verifiedFactSchema);

function writtenOf(row: { fleetId: string; shipId: string; writerKind: FactWriter['kind']; writer: string; facts: unknown; writtenAt: Date }): WrittenFacts {
  return {
    fleetId: idSchema('fleet').parse(row.fleetId),
    shipId: idSchema('ship').parse(row.shipId),
    writer: writerOf(row.writerKind, row.writer),
    facts: factsSchema.parse(row.facts),
    at: row.writtenAt,
  };
}

/** Each writer's verified facts about a ship, on Postgres (decision 0059). */
export function createPrismaVerifiedFactsRepository(db: Db): VerifiedFactsRepository {
  return {
    find: async (fleetId, { shipId, writer }) => {
      const row = await db.verifiedFacts.findUnique({ where: { fleetId_shipId_writerKind_writer: { fleetId, shipId, ...writerColumns(writer) } } });
      return row === null ? undefined : writtenOf(row);
    },
    save: async ({ fleetId, shipId, writer, facts, at }) => {
      const key = { fleetId, shipId, ...writerColumns(writer) };
      await db.verifiedFacts.upsert({
        where: { fleetId_shipId_writerKind_writer: key },
        create: { ...key, facts: [...facts], writtenAt: at },
        update: { facts: [...facts], writtenAt: at },
      });
    },
    list: async (fleetId) => (await db.verifiedFacts.findMany({ where: { fleetId } })).map(writtenOf),
    remove: async (fleetId, { shipId, writer }) => {
      await db.verifiedFacts.deleteMany({ where: { fleetId, shipId, ...writerColumns(writer) } });
    },
  };
}
