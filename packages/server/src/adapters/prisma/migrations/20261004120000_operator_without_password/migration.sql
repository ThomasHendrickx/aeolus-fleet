-- An operator a hosting installation created has no password.
ALTER TABLE "operators" ALTER COLUMN "password_hash" DROP NOT NULL;
