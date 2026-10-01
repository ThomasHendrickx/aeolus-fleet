import { SignInForm } from '../../components/organisms/sign-in-form';
import { AuthLayout } from '../../components/templates/auth-layout';

/** Sign in with the operator's email and password. Only the session cookie stays in the browser. */
export default function SignInPage() {
  return (
    <AuthLayout
      recovery={
        <>
          Forgot your password? Reset it on the server with{' '}
          <code className="inline-block rounded-xs bg-muted px-1.5 py-0.5 font-mono text-id whitespace-nowrap text-foreground">
            aeolus-server operator:reset-password
          </code>
        </>
      }
    >
      <SignInForm />
    </AuthLayout>
  );
}
