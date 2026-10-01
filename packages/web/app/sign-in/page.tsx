import { SignInForm } from '../../components/organisms/sign-in-form';
import { AuthLayout } from '../../components/templates/auth-layout';

/**
 * Sign in with the operator's email and password. Only the session cookie
 * stays in the browser. `?notice=signed-in-elsewhere` says the last session
 * ended because the operator signed in on another device.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { notice } = await searchParams;
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
      <SignInForm isSignedInElsewhere={notice === 'signed-in-elsewhere'} />
    </AuthLayout>
  );
}
