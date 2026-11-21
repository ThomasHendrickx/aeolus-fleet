-- Historical messages retain unknown sending provenance. No lease foreign key: retention is independent.
ALTER TABLE "messages" ADD COLUMN "sender_lease_id" TEXT;
