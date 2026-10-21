import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import { OwnSignIn, type OwnSignInLogin } from './own-sign-in';

const meta = {
  title: 'Organisms/OwnSignIn',
  component: OwnSignIn,
  args: { email: 'thomas@example.com', hasPassword: true, isSaving: false, isSaved: false, onSave: fn() },
} satisfies Meta<typeof OwnSignIn>;

export default meta;
type Story = StoryObj<typeof meta>;

const PASSWORD = 'staple battery horse';
const CURRENT = 'correct horse battery';

async function fillIn(canvasElement: HTMLElement, login: { current?: string; email?: string; password: string; repeat: string }): Promise<void> {
  const canvas = within(canvasElement);
  if (login.current !== undefined) {
    await userEvent.type(canvas.getByLabelText('Current password'), login.current);
  }
  if (login.email !== undefined) {
    await userEvent.clear(canvas.getByLabelText('Email'));
    await userEvent.type(canvas.getByLabelText('Email'), login.email);
  }
  await userEvent.type(canvas.getByLabelText('New password'), login.password);
  await userEvent.type(canvas.getByLabelText('Repeat the password'), login.repeat);
  await userEvent.click(canvas.getByTestId('settings-sign-in-save'));
}

/** argo has an email and password: the email is filled in. */
export const Idle: Story = {};
export const Saving: Story = { args: { isSaving: true } };
export const Saved: Story = { args: { isSaved: true } };
/** The fleet refuses, and says why; what was typed stays. */
export const SaveFailed: Story = { args: { saveError: 'An operator already signs in with lena@example.com' } };
/** The current password typed is not argo's: the fleet's reason shows under the title. */
export const WrongCurrentPassword: Story = {
  args: { saveError: 'That is not your current password' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('That is not your current password')).toBeVisible();
  },
};

/** Save hands the current password, the email and the new password over, once both new passwords match. */
export const SavesTheLogin: Story = {
  play: async ({ args, canvasElement }) => {
    await fillIn(canvasElement, { current: CURRENT, email: 'mathilde@example.com', password: PASSWORD, repeat: PASSWORD });

    await expect(args.onSave).toHaveBeenCalledWith({ email: 'mathilde@example.com', password: PASSWORD, currentPassword: CURRENT });
  },
};

/** No current password: said by its field, and nothing is saved. */
export const CurrentPasswordMissing: Story = {
  play: async ({ args, canvasElement }) => {
    await fillIn(canvasElement, { password: PASSWORD, repeat: PASSWORD });

    await expect(within(canvasElement).getByText('Enter your current password')).toBeVisible();
    await expect(args.onSave).not.toHaveBeenCalled();
  },
};

/** argo has no password yet: nothing is asked but the new email and password. */
export const NoPasswordYet: Story = {
  args: { hasPassword: false },
  play: async ({ args, canvasElement }) => {
    await expect(within(canvasElement).queryByLabelText('Current password')).toBeNull();

    await fillIn(canvasElement, { email: 'mathilde@example.com', password: PASSWORD, repeat: PASSWORD });

    await expect(args.onSave).toHaveBeenCalledWith({ email: 'mathilde@example.com', password: PASSWORD });
  },
};

/** Two different passwords: said by the second field, and nothing is saved. */
export const PasswordsDiffer: Story = {
  play: async ({ args, canvasElement }) => {
    await fillIn(canvasElement, { password: PASSWORD, repeat: `${PASSWORD}!` });

    await expect(within(canvasElement).getByText('The two passwords differ')).toBeVisible();
    await expect(args.onSave).not.toHaveBeenCalled();
  },
};

/** A password of 11 characters: the rule is said by the field, and nothing is saved. */
export const PasswordTooShort: Story = {
  play: async ({ args, canvasElement }) => {
    await fillIn(canvasElement, { password: 'a'.repeat(11), repeat: 'a'.repeat(11) });

    await expect(within(canvasElement).getByText('Use a password of at least 12 characters')).toBeVisible();
    await expect(args.onSave).not.toHaveBeenCalled();
  },
};

/** The press shows Saving at once, before the fleet answers. */
export const ShowsSavingAtOnce: Story = {
  render: function Render(args) {
    const [isSaving, setIsSaving] = useState(false);
    return (
      <OwnSignIn
        {...args}
        isSaving={isSaving}
        onSave={(login: OwnSignInLogin) => {
          args.onSave(login);
          // The answer never comes: the press alone must show it is working.
          setIsSaving(true);
        }}
      />
    );
  },
  play: async ({ canvasElement }) => {
    await fillIn(canvasElement, { current: CURRENT, password: PASSWORD, repeat: PASSWORD });

    const save = within(canvasElement).getByTestId('settings-sign-in-save');
    await expect(save).toHaveTextContent('Saving…');
    await expect(save).toHaveAttribute('aria-busy', 'true');
  },
};
