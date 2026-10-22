import { describe, expect, it } from 'vitest';

import { shownEntryOf } from './avatar-entry.js';

const NOTHING = () => undefined;

describe("an entry of the app's own in the avatar menu (header design H8)", () => {
  it('shows its label, and closes the menu once picked', () => {
    expect(shownEntryOf({ key: 'take-tour', label: 'Take the tour', icon: null, onSelect: NOTHING })).toEqual({ label: 'Take the tour', isWorking: false, shouldCloseMenu: true });
  });

  it('keeps the menu open when picking it starts work on the server, so the menu can say it is working', () => {
    expect(shownEntryOf({ key: 'sign-in-as-argo', label: 'Sign in as argo', workingLabel: 'Signing in as argo', icon: null, onSelect: NOTHING })).toEqual({
      label: 'Sign in as argo',
      isWorking: false,
      shouldCloseMenu: false,
    });
  });

  it('says it is working, with its working label, while that work runs', () => {
    expect(shownEntryOf({ key: 'sign-in-as-argo', label: 'Sign in as argo', workingLabel: 'Signing in as argo', isWorking: true, icon: null, onSelect: NOTHING })).toEqual({
      label: 'Signing in as argo',
      isWorking: true,
      shouldCloseMenu: false,
    });
  });
});
