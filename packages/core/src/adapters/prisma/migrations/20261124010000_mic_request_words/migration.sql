ALTER TABLE meeting_mic_requests
  ADD COLUMN words_message_id TEXT,
  ADD COLUMN content_type TEXT,
  ADD COLUMN model TEXT,
  ADD COLUMN sender_kind TEXT,
  ADD COLUMN sender_lease_id TEXT,
  ADD COLUMN signed_in_account_id TEXT,
  ADD COLUMN payload TEXT,
  ADD COLUMN sealed_data_key_id TEXT,
  ADD COLUMN sealed_nonce BYTEA,
  ADD COLUMN sealed_ciphertext BYTEA,
  ADD COLUMN sealed_payload_bytes INTEGER;

CREATE INDEX meeting_mic_requests_plain_payload_idx ON meeting_mic_requests (fleet_id, words_message_id) WHERE payload IS NOT NULL;
