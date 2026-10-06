-- CreateTable
CREATE TABLE "operators" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "operators_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operators_fleet_id_key" ON "operators"("fleet_id");

-- CreateIndex
CREATE UNIQUE INDEX "operators_email_key" ON "operators"("email");

-- AddForeignKey
ALTER TABLE "operators" ADD CONSTRAINT "operators_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Written by hand from here on.

-- argo has no secret: only the operator's console sign-in crews it (ADR 0012).
DELETE FROM "credentials" c
USING "ships" s
WHERE s."fleet_id" = c."fleet_id" AND s."id" = c."ship_id" AND s."kind" = 'operator';
