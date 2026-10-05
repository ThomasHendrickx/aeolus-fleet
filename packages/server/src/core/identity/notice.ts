import type { NoticeAudience, NoticeLink, ShipKind } from '@aeolus-fleet/common';

/**
 * A notice (decision 0023): plain text the installation shows above every
 * console page to the sessions of its audience, with optional links, and
 * dismissible or not. Its shape is checked where the installation sets it
 * (`setNoticesInputSchema`); here it is trusted.
 */
export interface Notice {
  id: string;
  audience: NoticeAudience;
  text: string;
  links: readonly NoticeLink[];
  isDismissible: boolean;
}

/** Whether a console session of a ship of this kind sees the notice (or the guide, decision 0024): everyone's always, the operators' on argo, the viewers' on the viewer ship. */
export function isForSessionOf(notice: Pick<Notice, 'audience'>, kind: ShipKind): boolean {
  switch (notice.audience) {
    case 'everyone':
      return true;
    case 'operators':
      return kind === 'operator';
    case 'viewers':
      return kind === 'viewer';
  }
}
