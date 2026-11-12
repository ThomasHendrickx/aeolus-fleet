-- The fleets the installation creates may share an operator email (decision 0020); the email of argo's own sign-in, with a password, stays unique.
DROP INDEX "operators_email_key";
CREATE UNIQUE INDEX "operators_sign_in_email_key" ON "operators"("email") WHERE (password_hash IS NOT NULL);
CREATE INDEX "operators_email_idx" ON "operators"("email");
