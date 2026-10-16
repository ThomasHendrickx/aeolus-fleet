import { startupWarnings } from './lib/startup-warnings';

/** Next.js calls this once as the web app's server starts: it warns of what will keep sign-in from working. */
export function register(): void {
  // The proxy runs in the edge runtime too; warn once, from the Node.js server.
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  for (const warning of startupWarnings(process.env)) {
    console.warn(warning);
  }
}
