-- A payload is at most 256 KB, counted in bytes (decision 0006): plain, or sealed with its plain byte count.
ALTER TABLE "messages" DROP CONSTRAINT "messages_payload_max_64kb";
ALTER TABLE "messages" ADD CONSTRAINT "messages_payload_max_256kb" CHECK (octet_length("payload") <= 262144);

ALTER TABLE "messages" DROP CONSTRAINT "messages_payload_plain_or_sealed";
ALTER TABLE "messages" ADD CONSTRAINT "messages_payload_plain_or_sealed" CHECK (
  ("payload" IS NOT NULL AND "sealed_data_key_id" IS NULL AND "sealed_nonce" IS NULL AND "sealed_ciphertext" IS NULL AND "sealed_payload_bytes" IS NULL)
  OR ("payload" IS NULL AND "sealed_data_key_id" IS NOT NULL AND "sealed_nonce" IS NOT NULL AND "sealed_ciphertext" IS NOT NULL AND "sealed_payload_bytes" BETWEEN 0 AND 262144)
);

ALTER TABLE "schedules" DROP CONSTRAINT "schedules_payload_plain_or_sealed";
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_payload_plain_or_sealed" CHECK (
  ("payload" IS NOT NULL AND "sealed_data_key_id" IS NULL AND "sealed_nonce" IS NULL AND "sealed_ciphertext" IS NULL AND "sealed_payload_bytes" IS NULL)
  OR ("payload" IS NULL AND "sealed_data_key_id" IS NOT NULL AND "sealed_nonce" IS NOT NULL AND "sealed_ciphertext" IS NOT NULL AND "sealed_payload_bytes" BETWEEN 0 AND 262144)
);
