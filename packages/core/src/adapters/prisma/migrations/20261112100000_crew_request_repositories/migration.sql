-- A crew request's workspace names a main repository and its sub-repositories
-- (#1760): a stored worktree workspace becomes repositories, that repository
-- (and its ref) as main and no sub-repositories, so no standing request holds
-- settings no trierarch can read (decision 0013).
UPDATE "crew_requests"
SET "settings" = jsonb_set(
  "settings",
  '{workspace}',
  jsonb_build_object('kind', 'repositories', 'main', ("settings"->'workspace') - 'kind', 'subRepositories', '[]'::jsonb)
)
WHERE "settings"->'workspace'->>'kind' = 'worktree';
