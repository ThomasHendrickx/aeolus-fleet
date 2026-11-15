/** Where a run measures, and who it is: the tokens come from the environment and are never printed. */
export interface Target {
  url: string;
  fleetToken: string;
  installationToken: string;
  fleetId: string;
  consoleSession: string;
}
