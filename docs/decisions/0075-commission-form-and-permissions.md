# 0075 Commission form and ship permissions

- Start with sending and receiving. Offer extras when wanted, in plain words, each permission its own choice, including core, plugin and fleet scopes. No bundles or roles; type grants no permission.
- Request a crew starts off when no computer can crew the ship, even with the trierarch plugin connected. It remains possible to turn it on. Otherwise the connected plugin's default is on; without it, off.
- Beside a disabled Commission button, name what is missing and what to do. Keep the fields' own hints, including Owner and crew settings.
- Change a live ship's permissions on its page beside its permissions. Add or remove only what the actor may grant, with `scopes:grant` and manage reach, under [0046](0046-scope-catalogue.md).

Why: a person can commission a ship that sends and receives without learning the scope catalogue, see what prevents commission, and give it another permission later.

Rejected: every scope shown at the start; a crew request starting on solely because a plugin is connected; field hints as the only reason for a disabled button; a separate page for changing a ship's permissions.
