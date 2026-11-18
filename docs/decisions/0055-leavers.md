# 0055 Leavers and their computers

- An organisation admin disables an account. Access ends at once; its ships stay. The account app ends its sign-ins, refuses new ones, ends its console sign-in as argo and removes its permission to sign in as argo. It tells the gateway to end its tokens and each fleet installation to cut off its tokens (0058). It releases the account's person ship and the trierarch app ships that person ship owns (0057). If an account is deleted, its person ship is released.
- The account app retries token cut-off notices to core and the gateway, and a deleted account's person-ship release, until each lands, only while the account remains disabled. Re-enabling cancels unfinished work, so stale work cannot cut off fresh access or release a newly crewed ship.
- A person ship keeps its id, history and owned ships after disable. It is crewed again when the account is enabled and it messages. A trierarch joins for its account, is owned by that account's person ship, and requires `trierarch:join` from whoever adds it (0046, 0057). Releasing a trierarch releases every lease it crewed; its requests stay for another computer (0010, 0030).

Why: access must end promptly while a person's ship and its history remain. Retrying unfinished work closes gaps during outages; cancelling it on re-enable prevents old work from affecting renewed access.

Rejected: retrying after re-enable; retiring ships on disable; releasing every ship a person ship owns; allowing every account to add a computer; widening `fleet:on-behalf` to manage.
