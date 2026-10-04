/**
 * How the console names a template repository (#161): one on github.com as
 * owner/repo with the GitHub mark, github.com/acme/templates reading as
 * acme/templates; any other by its name as squadrons derives it from the URL.
 */
export function repositoryLabel(name: string): { label: string; isGitHub: boolean } {
  const match = /^github\.com\/([^/]+\/[^/]+)$/.exec(name);
  return match?.[1] === undefined ? { label: name, isGitHub: false } : { label: match[1], isGitHub: true };
}
