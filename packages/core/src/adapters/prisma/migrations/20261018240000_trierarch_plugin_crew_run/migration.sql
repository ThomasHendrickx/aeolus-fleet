-- The trierarch plugin gives each machine's trierarch ship crew:run at commission, and a commission grants
-- only what its commissioner holds (decision 0046): every active trierarch-plugin ship gets crew:run.
UPDATE "ships" SET "scopes" = array_append("scopes", 'crew:run') WHERE "type" = 'trierarch-plugin' AND "retired_at" IS NULL AND NOT ('crew:run' = ANY("scopes"));
