import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import { OwnSignIn, type OwnSignInLogin } from './own-sign-in';

const meta = {
  title: 'Organisms/OwnSignIn',
  component: OwnSignIn,
  args: { email: 'thomas@example.com', isSaving: false, isSaved: false, onSave: fn() },
} satisfies Meta<typeof OwnSignIn>;

export default meta;
type Story = StoryObj<typeof meta>;

const PASSWORD = 'staple battery horse';

async function fillIn(canvasElement: HTMLElement, login: { email?: string; password: string; repeat: string }): Promise<void> {
  const canvas = within(canvasElement);
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
/** argo signs in only with a link from the terminal so far (accounts design, A1). */
export const NoPasswordYet: Story = { args: { email: null } };
export const Saving: Story = { args: { isSaving: true } };
export const Saved: Story = { args: { isSaved: true } };
/** The fleet refuses, and says why; what was typed stays. */
export const SaveFailed: Story = { args: { saveError: 'An operator already signs in with lena@example.com' } };

/** Save hands the email and the password over, once both passwords match. */
export const SavesTheLogin: Story = {
  args: { email: null },
  play: async ({ args, canvasElement }) => {
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
    await fillIn(canvasElement, { password: PASSWORD, repeat: PASSWORD });

    const save = within(canvasElement).getByTestId('settings-sign-in-save');
    await expect(save).toHaveTextContent('Saving…');
    await expect(save).toHaveAttribute('aria-busy', 'true');
  },
};
