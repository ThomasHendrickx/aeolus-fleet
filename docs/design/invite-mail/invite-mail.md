# The added mail says to what, and what Aeolus is

Design. Docs only. Thomas answered its four questions on 3 Nov (section 4). [Issue 1247](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1247), from the onboarding audit (PR 1232, friction 16). The mail and the welcome page are pagasae's; nothing is built until Thomas approves today and after, which then are the acceptance criteria.

## 1. Purpose

A person an organisation admin added knows, from the mail and the welcome page alone, that an admin of their organisation added them, to which organisation, and what Aeolus is, and the mail's link still works when they open it hours later.

## 2. Lessons to check against

### Today

The added mail (pagasae `emails/added-email.tsx`, sent by `lib/added-mail.ts` from `addAccount` in `features/organisation/actions.ts`), rendered from pagasae's main with its catalogue sample (Acme):

- Subject: "You were added to Acme on Aeolus". Preview: "Acme added you to its organisation on Aeolus."
- Body: "Acme added you to its organisation on Aeolus. Sign in with this email to see what you may do there."
- The link: "It works once and expires in 15 minutes."; beneath it, "Expired or already used? Ask for a new one on the sign-in page."
- "Not expecting this? An admin of Acme added this address. Nobody gets in without a sign-in link."
- The only words on what Aeolus is sit in the footer, outside the card: "Aeolus connects your AI agents into one fleet."

| Width | Light | Dark |
| --- | --- | --- |
| 375 | [today/mail-375-light.png](today/mail-375-light.png) | [today/mail-375-dark.png](today/mail-375-dark.png) |
| 1440 | [today/mail-1440-light.png](today/mail-1440-light.png) | [today/mail-1440-dark.png](today/mail-1440-dark.png) |

The welcome page the link leads to (pagasae `/welcome`, `TermsConsentForm`): "Welcome to Aeolus", early access, the terms. It names neither the organisation nor who added the person.

| Width | Light | Dark |
| --- | --- | --- |
| 375 | [today/welcome-375-light.png](today/welcome-375-light.png) | [today/welcome-375-dark.png](today/welcome-375-dark.png) |
| 1440 | [today/welcome-1440-light.png](today/welcome-1440-light.png) | [today/welcome-1440-dark.png](today/welcome-1440-dark.png) |

### What holds

| # | Lesson | Source |
| --- | --- | --- |
| L1 | The mail knows only the organisation's name: who added the account is not passed to it, and not stored | pagasae `lib/added-mail.ts`; `addAccount` has the admin in hand |
| L2 | An account has an email and a handle (its person ship's name, null until set), and no person's name | pagasae `prisma/schema.prisma`, `Account` |
| L3 | An added account has no admin right and no rights: what it may do comes later, from its groups. The mail cannot say what the person will do; the account's Home and Your rights do once they are given | `addAccount`'s comment; blueprint, The organisation admin |
| L4 | The link is a sign-in link: one use, `SIGN_IN_LINK_MINUTES` (15), the same as the sign-in mail. Opening it spends nothing; the browser signs in with a POST, so a mail scanner cannot use it up | pagasae `lib/sign-in-links.ts`, `app/(auth)/sign-in/link/page.tsx` |
| L5 | Anyone who holds the mailbox can ask the sign-in page for a fresh link at any time | blueprint, Sign-in link; the mail's own "Expired or already used?" |
| L6 | At a domain that signs in with its company the mail carries no link; the same who and what apply to it | `AddedEmail`, the `link === null` branch |
| L7 | The welcome page serves both the person who created the organisation and a person an admin added | pagasae `app/(auth)/welcome/page.tsx` |
| L8 | Every mail carries a plain-text version beside the HTML, and its dark rules for clients that ask | pagasae `emails/email-frame.tsx` |

## 3. After

Drawn with pagasae's own parts: the mail with `EmailFrame`, `EmailButton` and `EmailRule`; the welcome page with `TermsConsentForm` and `AuthHeading` on the AuthLayout. The sign-in background is picked at random at each load, so the desktop shots differ in it. The mockups take Thomas's answers in section 4.

The mail:

- Subject, as today: "You were added to Acme on Aeolus". Preview: "An admin of Acme added you to Acme on Aeolus."
- Body: "An admin of Acme added you to Acme on Aeolus." Then: "Aeolus connects Acme's people, AI agents and applications as one. Sign in with this email to see what you may do there."
- The link: "It works once and expires in 7 days."
- As today: "Not expecting this? An admin of Acme added this address. Nobody gets in without a sign-in link."
- The company sign-in mail takes the same words, without the link (L6). The plain text says the same as the HTML (L8).

| Width | Light | Dark |
| --- | --- | --- |
| 375 | [after/mail-375-light.png](after/mail-375-light.png) | [after/mail-375-dark.png](after/mail-375-dark.png) |
| 1440 | [after/mail-1440-light.png](after/mail-1440-light.png) | [after/mail-1440-dark.png](after/mail-1440-dark.png) |

The welcome page, for an account an admin added: "Welcome to Acme"; "An admin of Acme added you to Acme on Aeolus. Aeolus connects Acme's people, AI agents and applications as one."; then early access and the terms as today. The person who created the organisation sees today's page.

| Width | Light | Dark |
| --- | --- | --- |
| 375 | [after/welcome-375-light.png](after/welcome-375-light.png) | [after/welcome-375-dark.png](after/welcome-375-dark.png) |
| 1440 | [after/welcome-1440-light.png](after/welcome-1440-light.png) | [after/welcome-1440-dark.png](after/welcome-1440-dark.png) |

## 4. Questions, answered by Thomas

### Q1. How does the mail name who added the person?

Thomas answered 3 (3 Nov): "Lets leave PII out of this email". The mail and the welcome page name no admin: "An admin of Acme".

1. **The admin's email.** Always there, and the address the person can answer (L2). (Picked.)
2. The admin's handle, else the email. The handle is a ship's name, not a person's, and is null until set.
3. Only "An admin of Acme", as today. Says nothing new.

No admin is named, so pagasae keeps nothing new with the account (L1).

### Q2. How long does the added mail's link work?

Thomas answered 3 (3 Nov).

1. 15 minutes, as today; the mail leans on the sign-in page for a fresh link.
2. 24 hours.
3. **7 days, the added mail only; the sign-in mail stays 15 minutes.** An added person may open the mail days later; a longer one-use link adds little, since whoever holds the mailbox can ask for a link at any time (L4, L5). (Picked.)

### Q3. Which sentence says what Aeolus is?

Thomas answered in his own words (3 Nov): "Aeolus connects Acme's people, AI agents and applications as one.", with the organisation's name. The footer every mail shares keeps "Aeolus connects your AI agents into one fleet."; this design does not change it.

1. **"Aeolus connects Acme's AI agents into one fleet."** The footer's line, made the organisation's. (Picked.)
2. The footer's line as it is: "Aeolus connects your AI agents into one fleet." The agents are not the person's own.
3. A line written for a colleague who answers agents, not for an operator: Thomas's words.

### Q4. What does "what they will do there" (the issue) become?

Thomas answered 1 (3 Nov).

1. **The mail says the person signs in to see what they may do; the account's Home and Your rights show it once rights are given.** An added account has none at that moment (L3). (Picked.)
2. Send the mail only once the admin gave the account rights. A change to adding an account, and a mail that may never go.
