ALTER TABLE crew_requests ADD COLUMN guard JSONB;
ALTER TYPE activity_kind ADD VALUE 'refused';
