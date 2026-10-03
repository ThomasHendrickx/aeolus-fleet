-- CreateTable
CREATE TABLE "formation_attempts" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "squadron_id" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "formation_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formation_ships" (
    "attempt_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT,
    "position" INTEGER NOT NULL,

    CONSTRAINT "formation_ships_pkey" PRIMARY KEY ("attempt_id","name")
);

-- CreateIndex
CREATE INDEX "formation_attempts_fleet_id_finished_at_idx" ON "formation_attempts"("fleet_id", "finished_at");

-- AddForeignKey
ALTER TABLE "formation_ships" ADD CONSTRAINT "formation_ships_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "formation_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
