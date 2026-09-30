import { SignInForm } from '../../components/organisms/sign-in-form';

/** Sign in with the operator's email and password. Only the session cookie stays in the browser. */
export default function SignInPage() {
  return (
    <main>
      <h1>Sign in to Aeolus</h1>
      <SignInForm />
    </main>
  );
}
