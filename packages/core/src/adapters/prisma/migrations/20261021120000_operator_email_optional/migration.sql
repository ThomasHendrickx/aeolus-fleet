-- argo's own sign-in starts with no email and no password: fleet:init prints a
-- sign-in link, and argo sets its email and password in Settings (accounts
-- design, A1). The unique index stays: Postgres lets any number of rows hold none.
ALTER TABLE "operators" ALTER COLUMN "email" DROP NOT NULL;
