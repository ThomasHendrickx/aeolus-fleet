# Identity

Bounded context for ship secrets and the console session: issue and replace a secret, sign in, sign out, and turn a secret or a session token into the caller.

`index.ts` is the published surface: the only module another context may import. Use cases are not part of it; adapters import them from their own modules.
