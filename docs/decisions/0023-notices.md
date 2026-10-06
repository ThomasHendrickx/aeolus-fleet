# 0023 Notices

- The installation sets the console's notices: `installation.notices.set { notices }` replaces the whole list, in its order (none clears it); `installation.notices.get` reads it back. At most 5. Each has an id (a handle), an audience (`everyone`, `operators` or `viewers`), plain text (at most 300 characters), at most 3 links and whether it is dismissible. A link has a label and an `http` or `https` url, a sign-out, or both.
- Notices belong to the installation, not to a fleet, and write no event. A self-hosted server has no installation token, so it has no notices.
- Every console page shows the notices of its session's audience above it, in the installation's order: `operators` reach argo's session, `viewers` viewer sessions, `everyone` both.
- A console session dismisses a dismissible notice for itself only (`console.dismissNotice`); a new session shows it again. A dismissal follows the notice's id: set again under the same id, it stays dismissed; under a new id, it shows again. The dismissal is kept on the server and goes with the session's fleet.
- A link that signs out ends the console session first, then goes to its url, or to sign in without one.

Why: a hosting service needs to tell its operators and viewers things the console does not know (the hosted demo's banner is the first); one generic feature serves it with no hosting or demo code in the open package. Dismissals live on the server because the console keeps nothing in browser storage.

Rejected: a demo banner in the console package; a script the installation injects into the console (external code in a session); dismissals in browser storage.
