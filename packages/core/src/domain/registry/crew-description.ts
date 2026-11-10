/** The human description comes only from the crew's first summary sentence. */
export function crewDescription(statement: { readonly summary: string } | null): string | null {
  const summary = statement?.summary.trim() ?? '';
  if (summary.length === 0) {
    return null;
  }
  const end = /[.!?](?=\s|$)/u.exec(summary);
  return end === null ? summary : summary.slice(0, end.index + 1);
}
