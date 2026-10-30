import type { FleetId, ReportStep, ReportTask } from '@aeolus-fleet/common';

/**
 * A report's task as the overview and the ship page label it
 * (docs/design/monitoring, 4.2): a GitHub pull request as "PR #1391", an issue
 * as "#1407", any other URL as its host and path, each linked in a new tab; a
 * message as "a message", or with the other fleet’s name when known; linked
 * only when its server-read view allows it;
 * a kind the console does not know as "a task of unknown type". The title
 * always holds the whole URL or the ids.
 */
export interface ReportTaskLabel {
  icon: 'pullRequest' | 'issue' | 'link' | 'message' | 'unknown';
  label: string;
  title: string;
  /** Where the label links to; URL tasks open in a new tab. Null shows text. */
  href: string | null;
}

const GITHUB_HOST = 'github.com';
const GITHUB_ITEM = /^\/[^/]+\/[^/]+\/(pull|issues)\/(\d+)\/?$/;
/** How many characters of a fleet id stay on each side of the ellipsis. */
const KEPT_AT_START = 6;
const KEPT_AT_END = 4;

export function reportTaskLabel(task: ReportTask, viewerFleetId: FleetId | undefined): ReportTaskLabel {
  const { url, fleetId, messageId } = task;
  if (task.kind === 'url' && typeof url === 'string' && URL.canParse(url)) {
    return urlTaskLabel(url);
  }
  if (task.kind === 'message' && typeof fleetId === 'string' && typeof messageId === 'string') {
    const title = `${fleetId} · ${messageId}`;
    const label = fleetId === viewerFleetId ? 'a message' : `a message in ${typeof task.fleetName === 'string' ? task.fleetName : shortenedId(fleetId)}`;
    const path = `/messages/${messageId}`;
    const href = task.canOpen !== true || viewerFleetId === undefined ? null : fleetId === viewerFleetId ? path : `/sign-in/enter?fleet=${fleetId}&returnTo=${encodeURIComponent(path)}`;
    return { icon: 'message', label, title, href };
  }
  return { icon: 'unknown', label: 'a task of unknown type', title: `kind: ${task.kind}`, href: null };
}

function urlTaskLabel(url: string): ReportTaskLabel {
  const { host, pathname } = new URL(url);
  const item = host === GITHUB_HOST ? GITHUB_ITEM.exec(pathname) : null;
  if (item?.[1] === 'pull') {
    return { icon: 'pullRequest', label: `PR #${item[2] ?? ''}`, title: url, href: url };
  }
  if (item?.[1] === 'issues') {
    return { icon: 'issue', label: `#${item[2] ?? ''}`, title: url, href: url };
  }
  return { icon: 'link', label: `${host}${pathname.replace(/\/$/, '')}`, title: url, href: url };
}

/** "flt_01m5aa…9q2d": an id shortened in the middle after its prefix. */
function shortenedId(id: string): string {
  const start = id.indexOf('_') + 1 + KEPT_AT_START;
  return id.length <= start + KEPT_AT_END + 1 ? id : `${id.slice(0, start)}…${id.slice(-KEPT_AT_END)}`;
}

/** A report's step: short in a row ("3/5"), in words on the ship page ("step 2 of 3"). */
export function reportStepText(step: ReportStep, variant: 'row' | 'full'): string {
  return variant === 'row' ? `${String(step.at)}/${String(step.of)}` : `step ${String(step.at)} of ${String(step.of)}`;
}
