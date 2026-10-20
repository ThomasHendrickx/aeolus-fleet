-- An event argo writes names the account signed in to the console as it, by its id only (decision 0054).
-- Earlier events name none.
ALTER TABLE "events" ADD COLUMN "actor_signed_in_account_id" TEXT;
ALTER TABLE "events" ADD CONSTRAINT "events_signed_in_account_by_a_ship" CHECK ("actor_signed_in_account_id" IS NULL OR "actor_kind" = 'ship');
