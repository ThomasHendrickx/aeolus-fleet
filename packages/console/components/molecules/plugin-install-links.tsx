import { SOURCE_URL } from '../../lib/source';

/** Where installing the Aeolus Fleet plugin is described, per harness its crew lines paste into (#1235). */
const INSTALL_URLS = {
  claudeCode: `${SOURCE_URL}/blob/main/docs/guides/claude-code.md#1-install-the-plugin-once-per-machine`,
  codex: 'https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/plugins/aeolus-fleet/README.md#install-for-codex-desktop-or-cli',
} as const;

const linkClass = 'underline underline-offset-2';

/** One line beside crew lines: they need the Aeolus Fleet plugin, with where to install it for Claude Code and for Codex, each opened in a new tab. */
export function PluginInstallLinks() {
  return (
    <p className="text-meta text-muted-foreground">
      A crew line needs the Aeolus Fleet plugin, installed once per computer:{' '}
      <a href={INSTALL_URLS.claudeCode} target="_blank" rel="noreferrer" data-testid="plugin-install-claude-code" className={linkClass}>
        install it in Claude Code
      </a>{' '}
      or{' '}
      <a href={INSTALL_URLS.codex} target="_blank" rel="noreferrer" data-testid="plugin-install-codex" className={linkClass}>
        in Codex
      </a>
      .
    </p>
  );
}
