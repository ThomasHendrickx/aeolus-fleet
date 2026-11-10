/** Approved sentence examples shared by the domain and PostgreSQL projection tests. */
export const CREW_DESCRIPTION_FIXTURES: readonly (readonly [string | null, string | null])[] = [
  ['\u00a0Ready?\u00a0More.\u00a0', 'Ready?'],
  [null, null], ['', null], [' \n\t ', null],
  ['  Builds ships. More detail.', 'Builds ships.'],
  ['Ready? Yes!', 'Ready?'], ['Go!\nNow.', 'Go!'],
  ['Dr. Smith builds.', 'Dr.'], ['A.B works', 'A.B works'],
  ['first\nline ends. second', 'first\nline ends.'],
  ['  Καλημέρα 世界！  ', 'Καλημέρα 世界！'],
  ['100%_\\ literal', '100%_\\ literal'],
];
