-- A sign-in ticket from pagasae may name the account it signs in as argo, by its id only, never its email
-- (decisions 0054, 0058); the console session it starts keeps that id. Null for argo's own sign-in and a viewer.
ALTER TABLE "sign_in_tickets" ADD COLUMN "account_id" TEXT;
ALTER TABLE "console_sessions" ADD COLUMN "account_id" TEXT;
