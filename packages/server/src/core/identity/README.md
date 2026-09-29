# Identity

Bounded context for ship secrets, the operator account and the console session: issue and revoke a ship secret, sign in with the operator's email and password (the session crews `argo`, which has no secret), sign out, reset the operator password, and turn a ship secret or a session token into the caller.

`public.ts` is the published surface: the only module another context may import. Use cases are not part of it; adapters import them from their own modules.
