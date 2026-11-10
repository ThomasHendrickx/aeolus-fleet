/** Approved sentence examples shared by the domain and PostgreSQL projection tests. */
export const CREW_DESCRIPTION_FIXTURES: readonly (readonly [string | null, string | null])[] = [
  ...['\u0009', '\u000a', '\u000b', '\u000c', '\u000d', ' ', '\u00a0', '\u1680', '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005', '\u2006', '\u2007', '\u2008', '\u2009', '\u200a', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff'].map((space): readonly [string, string] => [`${space}Ready?${space}More.${space}`, 'Ready?']),
  ['\ufeff\u00a0\u2028', null],
  ['Ready?\u0085More.', 'Ready?\u0085More.'],
  ['Ready!\u180eMore.', 'Ready!\u180eMore.'],
  ['Ready.\u200bMore.', 'Ready.\u200bMore.'],
  ['Ready?', 'Ready?'],
  [null, null], ['', null], [' \n\t ', null],
  ['  Builds ships. More detail.', 'Builds ships.'],
  ['Ready? Yes!', 'Ready?'], ['Go!\nNow.', 'Go!'],
  ['Dr. Smith builds.', 'Dr.'], ['A.B works', 'A.B works'],
  ['first\nline ends. second', 'first\nline ends.'],
  ['  Καλημέρα 世界！  ', 'Καλημέρα 世界！'],
  ['100%_\\ literal', '100%_\\ literal'],
];
