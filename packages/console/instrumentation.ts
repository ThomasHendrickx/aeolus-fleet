import { missingConsoleUrlOf } from './lib/console-origin';
import { startupWarnings } from './lib/startup-warnings';

/** Next.js calls this once as the web app's server starts: it warns of what will keep sign-in from working, and stops a start that cannot sign in at all. */
export function register(): void {
  // The proxy runs in the edge runtime too; warn once, from the Node.js server.
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  for (const warning of startupWarnings(process.env)) {
    console.warn(warning);
  }
  const missing = missingConsoleUrlOf(process.env);
  if (missing !== undefined) {
    process.stderr.write(`${missing}\n`);
    process.exit(2);
  }
}
