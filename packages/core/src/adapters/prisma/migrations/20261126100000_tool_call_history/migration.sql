DROP INDEX "events_crew_idx";

CREATE INDEX "events_crew_idx" ON "events" ("fleet_id", "occurred_at")
  WHERE "type" IN (
    'ShipClaimed', 'LeaseRevoked', 'LeasePushed', 'ShipReported', 'ToolCallObserved',
    'TurnReported', 'StatementSet', 'CrewStatusChanged', 'SignInTicketIssued',
    'ViewerSessionStarted', 'StartingPromptIssued', 'CredentialRevoked'
  );
