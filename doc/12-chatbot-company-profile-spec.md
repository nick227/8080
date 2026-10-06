# 12 — Chatbot: guided workflows and the company profile

**Status:** Design, recorded 2026-10-05. Slice A (bot message choices) built 2026-10-05, uncommitted (§4.3). Slices B–D not built.
**Supersedes:** doc/08 §4.9 "observational only" (replaced by §2 below).
**Builds on:** doc/08 (bot runtime, rails, ItemService posting), doc/09 (Workspace, `runAction`, policy), doc/10 (block documents, `DocumentContent`, room links).

The workspace's chatbot acts as a **host in one shared channel**: it welcomes every member there, publicly. It offers the workspace creator a company description. A short interview fills a reusable **company profile** for the workspace, and chatbot generates a native document from it and posts the link. The profile outlives the document: every later document is written from it, and every correction improves it.

## 1. Goal

One vertical slice that proves: bot interaction → deterministic workflow → durable knowledge → AI generation → native artifact.

1. Chatbot posts a welcome message automatically.
2. Clicking chatbot's tile opens the workspace's shared bot channel (one for everyone; §3).
3. Bot messages can carry buttons.
4. A click advances a server-owned workflow. The LLM never sees a click.
5. The company-profile workflow asks one open question, then only what is missing.
6. Answers become structured, sourced company facts.
7. The last step generates a Company Description document automatically.
8. Chatbot posts the link and says what it learned and created.
9. Reopening the channel later resumes from the profile and history.

## 2. AI policy (binding, 2026-10-05; replaces doc/08 §4.9)

> **AI may extract facts, draft content, and trigger deterministic workflows. Important
> workspace changes are surfaced to the user. Explicit approval is required only where
> the product decides it matters.**

- **The model returns data; deterministic code acts.** An AI call is a pure function: input → schema-validated JSON. The workflow engine decides what to write, post or create. The AI module still imports nothing that posts, publishes or writes workspace rows (static architecture test, as for the router).
- **The model never chooses the next step.** Branching, validation, required fields, "what's missing" and completion are code. The server computes "missing" from empty fields; it doesn't trust a model's list.
- **Surface, then correct.** For this flow, nothing needs approval in advance. After it creates something, chatbot says what it learned and what it created, and offers to fix it.
- **Where approval matters (product rule):** AI never silently overwrites a fact a person stated or corrected (`stated` / `corrected`, §5.3). It asks. Filling an empty fact, or replacing an `inferred` one, needs no approval. Future triggers (sending email, sharing outside the workspace, deleting, changing access) need approval. None are in this slice.
- **Attribution.** AI-assisted changes run through `runAction` with the member who answered as the actor and a new origin `ActionOrigin.assistant`. `ActorKind.agent` stays reserved. Bots are still never workspace members.
- **Unchanged:** the router stays shadow-only. Explicit mentions stay deterministic. No AI calls from timers, tests or empty rooms. Hard caps, per-request logging and kill switches apply to the assistant too (§7). **With AI off, the product still works** (§6.4).

## 3. One shared bot channel (decided 2026-10-05)

There are no private direct threads. One channel per workspace holds everything chatbot does, so it is transparent: the bot reads as the workspace's host announcing what happens, not as a hidden assistant.

```
Nick joined
chatbot: Welcome, Nick.            ← creator: richer welcome + [Set up company profile] [Later]
Sarah joined
chatbot: Welcome, Sarah.           ← member: simple welcome + [See what I can do]
chatbot: I created Company Description from the workspace profile.
```

- `WorkspaceChannel { workspaceId @id, roomId }`. The room is an ordinary private room. Workspace members are its members. chatbot is seated (`RoomBot`). Rooms keep no `workspaceId` (D5); this row is the link.
- **Everyone is welcomed publicly**, unsolicited, when they become an active member: workspace created (the creator), or invite accepted.
- **Only the creator gets the setup interview and the description.** The creator's welcome offers [Set up company profile] [Later], with the choice addressed to them (`forUserId`). Everyone else sees it and the answers, but can't answer.
- Profile edits are gated to the creator, owners and admins (the flow's `canChoose`, then `workspacePolicy`). Document creation can open up per document type later.
- **Guests (not logged in):** read-only, or a limited greeting. They get no interview and no profile actions.
- Logged-in members can talk to chatbot in the same channel afterwards.
- Free-text interview answers are taken only from this room, only from the person the run belongs to, and only while that run is waiting for text.
- **Later safeguard:** personal or exploratory prompts will eventually need a private mode, because one transparent channel gets awkward. That is out of scope for the POC.

## 4. Buttons on bot messages

### 4.1 Model

```
Message.actions  Json?   // bot-authored messages only
  { runId, stepId,
    mode: 'one' | 'many',
    options: [{ id, label }] }          // ≤ 8 options, label ≤ 40 chars
Message.choice   Json?   // set once
  { optionIds: string[], userId, at }
```

`Message` already holds the content, so the actions go there. In the API, `Item.message.actions` and `Item.message.choice` are read-only and only set by the server.

### 4.2 Choosing

`POST /items/{itemId}/choice` `{ optionIds }`:

- The item's author must be a bot and the message must have `actions`.
- The caller must be able to see the room (else 404) and be allowed to answer: `forUserId`, plus the flow's `canChoose`. Otherwise 403 `NOT_YOUR_CHOICE`.
- The option ids must be valid for `mode`. Otherwise 400 `INVALID_CHOICE`. An item with no offer gets 400 `NOT_A_CHOICE`.
- **The first choice wins.** The same person repeating the same choice gets 200 and nothing changes. Any other answer, or the item being deleted, gets 409 `CHOICE_CLOSED`.
- In one transaction: lock the message row, set `choice`, journal `item.updated`, and run the flow's `advance` (Slice B: record the `WorkflowAnswer` and move the run). Its follow-ups are posted after the commit. Every viewer's buttons lock and show who chose.

The click never becomes a chat item, and its text never goes to a model.

### 4.3 As built (Slice A, 2026-10-05)

- **Schema:** `Message.actions Json?` and `Message.choice Json?`.
- **Offers:** `lib/choice.ts` (`storedActions` validates 1–8 options, slug ids, labels ≤ 40, mode `one`/`many`). Offers only go through `ItemService.send(…, { actions })`, which is server-internal: a human actor throws, and HTTP can't reach it (400 on an unknown body field).
- **Answers:** `services/ChoiceService.ts` (`choose`); flows register in `bots/flows/registry.ts` (`registerChoiceFlow(key, { canChoose?, advance })`). A row lock (`SELECT … FOR UPDATE`) makes concurrent clicks resolve to exactly one winner. Follow-ups are posted by the bot that asked, on the same surface. If the rails refuse one (cap, unseated), it is logged and the answer stands.
- **Serialization:** the API shows `actions: { mode, options, forUserId }` (flow and step stay on the server) and `choice: { optionIds, userId, at }`. Both are null when the message is hidden (deleted or muted).
- **Workflow allowance (replaces the first "an answer counts as a human turn" workaround):** posts from a *registered* workflow (`bots/flows/registry.ts`, `ItemService.send(…, { workflow })`, stored as `Message.workflow`) run on their own budget. The limits are `BOT_WORKFLOW_ROOM_CAP` (30 per room per `BOT_ROOM_CAP_WINDOW_SEC` window → 429 `WORKFLOW_CAP`) and `BOT_WORKFLOW_POSTS_PER_ANSWER` (3; a flow returning more is a bug and rolls the answer back). The ordinary caps (`BOT_ROOM_CAP`, `BOT_MAX_CONSECUTIVE`) don't see workflow posts: workflow posts neither spend them nor break a consecutive run. An answer is not a human turn. Only bots can post for a workflow, and only for a registered one. If the allowance refuses a follow-up, the answer still stands.
- **API:** `POST /items/{itemId}/choice` (`chooseOption`); SDK `useChooseOption()`, models `ChoiceActions` / `ChoiceOption` / `Choice`.
- **Web:** `features/room/ChoiceBar.tsx` + `choices.css`, rendered by `ChatStream` from `item.actions`. One option per click for `one`; toggles + Done for `many`. Answered → locked, the chosen options in signal, "You chose …" or "Chosen: …". Not yours → disabled, "Waiting on someone else".
- **Dev demo:** `bots/flows/demo.ts` (Yes / Not now → 4 tones → `many` channels → end; Not now → Start → back to the question), started by `POST /dev/bots/offer { handle, roomId, forUserId? }` (BOTS_DEV=1 only).
- **Proof:**
  - server `choices.test.ts` 13/13; full suite 388/388.
  - browser (scratchpad `e2e/choices.cjs`, isolated pair :3002/:5174 on the TEST DB, two viewers, desktop + mobile) 24/24 ×2: open vs waiting, lock + "You chose", live "Chosen:" for the other viewer, 4-option and `many` steps, persisted after reload, 409 on change, 403 for the other person.

## 5. Data

### 5.1 Workflow runs

```
WorkflowRun     id, workspaceId, memberId, roomId,
                workflowKey(64), version Int,     // 'company-profile', 1
                stepId(64), status,               // active | waiting | done | paused | failed
                state Json,                       // small cursor: follow-up queue, brief
                createdAt, updatedAt
                @@index([workspaceId, memberId, status])
WorkflowAnswer  id, runId, stepId,
                kind,                             // choice | text
                optionIds Json?, itemId?,         // the chat item that carried free text
                raw Text?,                        // the text exactly as entered
                createdAt
```

- At most one active or waiting run per (member, workflowKey).
- Steps live in typed code (`bots/workflows/companyProfile.ts`) and use the registry style of doc/08 §4.2. They are versioned, so a run finishes on the version it started on.
- Waits survive restarts because the state is in the DB, not in timers.

### 5.2 Company profile (one per workspace, first-class, no EAV)

```
CompanyProfile           workspaceId @id, revision Int, updatedAt
                         name, location, serviceArea, purpose, brandVoice   // scalar facts (nullable)
CompanyFact              id, workspaceId,
                         kind,        // offering | customer | differentiator | goal | term | avoid
                         value(500),
                         status,      // inferred | stated | corrected
                         sourceAnswerId?, sourceRunId?, setByMemberId,
                         createdAt, supersededAt?
CompanyScalarSource      workspaceId, field, status, sourceAnswerId?, setByMemberId, updatedAt
                         @@id([workspaceId, field])
CompanyProfileRevision   id, workspaceId, revision, snapshot Json, actionExecutionId, createdAt
```

- `kind` and the scalar fields are a fixed enum and fixed columns. Adding a fact type is a migration, on purpose.
- Every profile change writes a revision through `runAction`. Documents record the revision they came from.
- **Status rule (§2):** `inferred` = extracted by the model. `stated` = given directly by a person (a button, or a direct answer to that field's question). `corrected` = fixed by a person afterwards. AI may fill an empty field or replace `inferred`. Replacing `stated`/`corrected` requires a [Update profile] [Just this document] choice.
- Policy: `companyProfile.read` for every active member, `companyProfile.edit` for owners and admins. A member's interview can still produce documents. Their facts are saved only if they can edit the profile; otherwise they apply to that document only. This is open question Q2.

### 5.3 Three layers, all kept

| Layer | Where | Purpose |
|---|---|---|
| Raw answer | `WorkflowAnswer.raw` | Provenance; re-extract later without asking again |
| Normalized fact | `CompanyProfile` / `CompanyFact` | Source of truth, reused and improved |
| Generated artifact | `Document` (blocks) | Disposable; regenerated from facts |

### 5.4 The document

- A native block `Document`, owned by the member and saved through `DocumentService.create` + `DocumentContentService.save`, so all registry/grant/live behaviour applies.
- `provenance` (existing column): `{ generator: 'company-description', profileRevision, brief: { audience, style, length }, assistantCallId }`.
- It is linked to the bot channel (`DocumentRoomLink`), so it shows up in the room and the room shows up in the document.
- Blocks: one `title` and `paragraph` blocks, using the existing types. No new block types.

## 6. The company-profile workflow (v1)

### 6.1 Steps

```
welcome      "Hi, I'm chatbot. I can write a company description for you — it takes
              a couple of minutes. Want to start?"            [Yes, let's go] [Not now]
  Not now →  paused; the next open of the channel shows       [Start]
about        "Tell me about your company in your own words: its name, where you are,
              what you do and what makes you different."       (free text)
extract      AI (§7.1) → fills empty / inferred fields; server computes `missing`
followups    one question per missing required field, fixed order, ≤ 3 asked:
              name        free text
              location    [Local] [Regional] [National] [Global] → free text "Where?"
              purpose     free text
              customers   many: [Consumers] [Businesses] [Government] [Nonprofits]
              offering    free text
              differ.     free text
             still missing after 3 → continue; the gap is named in the summary
brief        tone (saved as brandVoice):  [Professional] [Friendly] [Bold] [Technical]
              (skipped if brandVoice is already stated)
             audience: [Customers] [Prospects] [Partners] [Investors] [General public]
             length:   [Short] [Medium] [Detailed]
generate     AI (§7.2) → normalizes the follow-up text answers + writes the document
create       Document created, linked, profile revision written
summary      "I created **Company Description** and learned: name, location, … (gap:
              differentiator)."                    [Open document] [Fix a fact] [Write another]
```

- Required for the company description: name, location, purpose, offering, customers. A differentiator is optional but asked for.
- A free-text follow-up is stored raw and **not** sent to a model on its own. Its normalization rides on the generate call.
- Audio or video in place of a text answer: chatbot asks for typed text for now (Q3). Transcription is a later step.

### 6.2 Returning

When the channel is opened with no active run:
- No profile yet → the welcome, again (once a day at most).
- Profile complete → "Your company profile has N facts." [Write a document] [Review profile].

### 6.3 Fixing a fact

[Fix a fact] → a list of facts as buttons, one choice → "What should it be?" (free text) → saved as `corrected`, new revision → "Updated. [Regenerate the description] [Done]". The document is not rewritten silently.

### 6.4 AI off, or a failed call

- Extract unavailable (off, cap, timeout, invalid JSON) → every required field becomes a follow-up, asked directly and saved as `stated`. The 3-question limit doesn't apply.
- Generate unavailable → a **template** document is built from the facts ("{name} is a {location} company that {purpose}…"). The summary says it's a template, with [Try again].
- So with `AI_ASSISTANT` off the whole flow still works end to end. That is also the test oracle.

## 7. AI calls

There are exactly two calls in this workflow. Both use strict JSON-schema output (as in the router), are validated on return, and are discarded if invalid.

### 7.1 Extract

Input: the raw `about` text, plus the current profile (to avoid re-asking).
Output: `{ name?, location?, serviceArea?, purpose?, brandVoice?, facts: [{ kind, value }] }`, each with a confidence in 0–1. Values below 0.5 are dropped. The model doesn't return `missing`; the server computes it.

### 7.2 Generate

Input: the profile snapshot, the raw follow-up answers, the brief, and the document type.
Output: `{ profilePatch: <same shape as extract>, document: { title, paragraphs: string[] } }`. One call both normalizes and writes. `profilePatch` follows the status rule (§5.2).

### 7.3 Rails

- `AI_ASSISTANT=on` + key + model, separate from `AI_ROUTER`. It is off under test and with `BOTS=off`.
- Caps per workspace: calls per day, estimated USD per day, timeout. They are global too.
- Each call is triggered only by a human answer in the channel, never by a timer.
- **Log every call** (`AssistantCall`: workspace, run, step, model, input size, latency, tokens, cost, result/error). The same fields as `BotRoute`.
- The provider can be injected (`setAssistantProvider`) so tests never use the network.

## 8. Enforcement

- Static architecture test: `bots/assistant/*` (the AI calls) imports no service that posts, publishes, creates documents, or writes profile rows. It writes only `AssistantCall`. Only `bots/workflows/*` calls it.
- The existing router tests in `ai-router.test.ts` stay as they are.
- Behaviour tests (fake provider):
  - transitions per answer
  - first choice wins and a repeat is idempotent
  - a stranger gets 404 and a closed step gets 409
  - the run resumes after a restart
  - the overwrite rule (`stated` is never replaced silently)
  - the AI-off path end to end
  - caps and timeout fall back
  - the document's provenance and room link
- Browser suite: welcome → buttons → about → follow-ups → document link opens (desktop + mobile).

## 9. Slices

- **A — Buttons.** Built (§4.3).
- **B — Channel + workflow + profile, AI off.** `WorkspaceChannel`, public welcomes (creator vs member vs guest), `WorkflowRun/Answer`, profile tables + revisions, all-direct follow-ups, the template document, the summary, [Fix a fact]. Fully usable without AI.
- **C — AI.** Extract + generate, caps, `AssistantCall` log, fallbacks.
- **D — More from the profile.** [Write another]: About page, sales intro, social bio. Each is a generator with its required facts + brief, on the same engine. Later: detecting profile changes in ordinary channel messages ("we aren't targeting restaurants anymore" → [Update profile] [Just this document]). That needs reading every message, so it waits for C's logs.

## 10. Open questions

- ~~Q1~~ Decided: every member is welcomed publicly in the one shared channel; only the creator gets the interview and the description (§3).
- **Q2** Should a non-admin's answers become facts? (Default: no, they apply to that document only.)
- **Q3** Voice answers: typed only for the POC (default), or transcription in this slice?
- **Q4** Where does "Review profile" live? (Default: a bot message listing the facts. A profile page can come later.)
