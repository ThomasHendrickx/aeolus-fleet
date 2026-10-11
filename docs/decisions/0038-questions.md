# 0038 Questions

- A ship asks the operator by sending argo a message of content type `application/vnd.aeolus.question+json`. Its payload is JSON: `id` (a uuid of its own, so other questions can name it), `title`, `context`, `options` (at least one, each `key` numbered from 1 and unique, `label` and `detail`) and `pick` (`option`, the key the asker would choose, and `why`).
- argo answers with a reply to the question's message (`inReplyTo`) of content type `application/vnd.aeolus.answer+json`. Its payload is JSON: `questionId` (the question's uuid) and either `option` (one key) with an optional `note`, or a `note` alone (more context needed, or none of the options).
- Content types compare without case and parameters. Schemas in `common/src/schemas/question.ts`.
- Core stays unaware of them: it stores and carries both like any message and never reads a payload. Its only help is content-agnostic: Reply takes a content type, and `fleet.inbox` lists argo's replies to each message. The console's server (decision 0033) reads argo's inbox for questions and their answers, checks an answer against its question, and sends it through Reply.
- A question is open until argo has sent an answer naming it, whatever its delivery's state. The first such answer is the one shown. A message of the question type whose payload is not a question is a plain message.

Why: questions that need the operator land in one place with what it takes to answer, and the answer reaches the asking ship as a reply it already knows how to receive. Payloads are data only; how a question looks is the console's job.

Rejected: a question setting, fleet concept or question parsing in core (a ship's prompt says where it asks; Aeolus never reads message content); options keyed by free text (the operator answers by number); a question open until its delivery is acknowledged (marking a message done is not answering it).
