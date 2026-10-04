# 0021 Squadrons serve many fleets, switched per fleet

- One squadrons install serves every fleet at its `FLEET_URL`: one connection per fleet, each with its own management ship and kept crew token. Any signed-in operator there works on their own fleet only; one fleet never sees another's repositories, catalogue, squadrons or connection.
- A hosting service (pagasae) switches squadrons on or off per fleet through squadrons' installation procedures (`installation.setEnabled`, `get`, `delete`), guarded by squadrons' own installation token (`INSTALLATION_TOKEN`) in the `x-aeolus-installation-token` header, as the server's (decision 0020). The switch lives in squadrons' database; the server knows nothing of it.
- No token: the installation is open, the installation procedures do not exist, and every fleet is served, as self-hosted squadrons always was. With a token, a fleet is off until switched on.
- Off: squadrons does nothing for that fleet. Its API answers that squadrons is off (only `connection.status` answers, with `enabled: false`), Connect is refused, its flagships stop receiving and its stand-downs wait. Everything is kept, so on again resumes.
- Delete forgets everything squadrons holds of the fleet: repositories and tokens, catalogue, squadrons and kept messages, formation attempts, connection, switch. It tells the fleet nothing; its ships stay there. A replayed request id answers the first answer; a delete keeps only the request's hash.

Why: hosted Aeolus runs one squadrons for all fleets and keeps the option to limit or charge for it per fleet, while the server stays free of squadrons.

Rejected: the flag on the server; one squadrons process per fleet; retiring a deleted fleet's ships from squadrons; a delete that keeps a backup.
