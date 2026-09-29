import type { Authenticate } from '../../core/identity/authenticate.js';
import type { SignIn } from '../../core/identity/sign-in.js';
import type { SignOut } from '../../core/identity/sign-out.js';
import type { Ping } from '../../core/shared/ping.js';

/** The use cases procedures can call. Wired once at startup. */
export interface UseCases {
  ping: Ping;
  signIn: SignIn;
  signOut: SignOut;
  authenticate: Authenticate;
}

/** What the request carried to say who it is. Neither is trusted until a use case checks it. */
export interface RequestCredentials {
  /** A ship secret from `Authorization: Bearer`. */
  bearer?: string;
  /** A console session token from the session cookie. */
  sessionToken?: string;
}

/** Writes the console session cookie on the response. */
export interface SessionCookie {
  set(token: string, expiresAt: Date): void;
  clear(): void;
}

export interface Context {
  useCases: UseCases;
  credentials: RequestCredentials;
  sessionCookie: SessionCookie;
  /** Who is asking, for rate limits: the client address. */
  clientKey: string;
  /** Counts sign-in attempts per client; false when over the limit. */
  takeSignInAttempt: (clientKey: string) => boolean;
}
