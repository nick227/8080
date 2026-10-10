# 13 — Chat and Collaboration UX: 8080 Commercial Redesign

**Status:** developer implementation addendum. **Goal:** make everyday team chat, room conversation, task context and live Stream feel like one dependable collaboration product, without flattening chat into the universal table system.

## A. Scope and current architecture to verify

Source locations identified in earlier audit include `views/Room.tsx`, `features/room/ChatShell.tsx`, `features/room/RoomFloor.tsx`, and team/room presence components. The app currently supports a persistent right chat surface with **closed, open and full** presentation modes, and separate Stream/live room media. Inspect latest HEAD to verify routing, message storage, threads, unread badges, mention behavior, attachment handling, event links, and precise availability of integrations. Do not claim unsupported DMs, message search, reactions, read receipts, typing state or calls without verifying them.

Map all chat entry points: global shell, Stream, Team member, task activity, Company, agent team-message delivery, notifications. Record how identities, company tenant, conversation membership, presence and room permissions are resolved. Document whether chat is truly persistent across all page modes and what happens during full-page document/email editing. Identify overlapping/duplicated chat controls with existing Messaging/Agents navigation.

**Terminology:** `Automations (Agents)` is scheduled outbound communication, **not** the primary human chat inbox. `Chat` is conversational messages. `Stream` is the live collaborative room/media surface. Distinguish them in UI labels and search synonyms.

## B. The intended three-layer communication model

1. **Global Chat:** available from every company route via an unobtrusive header affordance and optional right rail on wide screens. Closing chat hides UI, not messages, draft text or unread state.
2. **Conversation / Thread Page:** full-page conversation when a user intentionally focuses on reading/searching/replying; route is deep-linkable and respects Back. A right-side chat panel remains a convenience, not the only way to have a proper conversation.
3. **Stream:** live room/media and participants, with chat as complementary communication. Preserve presence and media controls. Stream chat should not become a competing, separate message history without explicit schema semantics.

Separate **human-to-human conversation**, **automated agent postings**, **system/activity events**, and **notifications** visibly. Agents may publish into company/internal chat only when supported and authorized, with attribution to the automation and a link to run history. Do not pretend agents are human senders.

## C. Product navigation and discoverability

- Chat access should be consistently visible in global header as a labeled icon or affordance with unread count, or attached to a user-tested quick-access surface. Stream remains its own prominent primary environment.
- Manage → Automations refers to **scheduled email/internal team automations**. Do not use generic “Messaging” to refer to automation configuration, which confuses the distinction.
- User avatar is personal account; clicking another person's avatar in chat opens their **company member profile**, not privileged account settings.
- Search/command supports people, chat conversations (if indexed), linked tasks/docs and agent activity with permission-aware results.
- Messages from task/document references deep-link to full item pages; return restores the conversation, scroll anchor and unsent draft.
- Notifications for mentions and important replies lead to the exact message context, avoiding just opening the generic chat rail.

## D. Wide-screen chat layout

**Collapsed:** unobtrusive access, honest unread badge, background data subscriptions proportional to needs.

**Docked:** right rail next to Work/Manage/Company/Stream with predictable width, independent scroll for history and composer, resizable within comfortable bounds if implemented. Main canvas retains reasonable minimum width; editor-heavy routes (email studio, documents, calendars) may automatically suggest immersive mode or hide dock **without losing conversation**; user overrides persist per workspace where appropriate.

**Expanded/focus:** full-page or maximized dedicated chat experience with conversation selector, participants, search/context, messages and composer. Prefer full page to giant overlay if task demands prolonged use.

**Stream:** live room controls are primary; chat may dock to right or become a switchable panel depending on viewport. Switching media to chat must not unexpectedly turn off microphone/camera or lose a draft.

Avoid three simultaneously competing sidebars (left navigation, chat list, chat dock). The optional global quick-nav should collapse automatically or remain absent when constrained.

## E. Conversation anatomy and message interactions

A clear conversation header shows name, participants, company context, presence where reliable, options. Scrollable message history groups by sender/time; day boundaries, timestamps and delivery/failed states are legible in every theme. Avatar size, spacing and sender identity consistent with Team/user profile. Composer remains anchored in the accessible visual viewport.

- Enter to send vs newline must be clear and configurable or matched to current convention; always support accessible send button.
- Sending immediately acknowledges intent; pending, sent and failed states shown reliably. Failed drafts remain recoverable; do not duplicate messages on retry.
- Editing, deleting, reactions, attachments, replies, mentions, pins, search etc. are **capability-gated**: preserve whatever exists and add only after backend permission/storage contract is verified. Do not imply a decorative UI is a functional feature.
- Long threads use stable pagination/scroll anchoring. Loading older messages shouldn't jump view. New messages while reading history show a discrete 'New messages' control instead of yanking scroll.
- Preserve composition drafts per conversation during navigation, reload where policy allows, and switching between dock/full page. Avoid persisting sensitive draft content insecurely; document chosen storage scope and expiry.
- Paste/upload use existing validated media pipeline; upload progress, cancellation and failure recovery; server authorization and file-type/size enforcement remain primary.
- Esc closes a popover, not the chat page or unsent composer; keyboard focus on opening lands logically, and closing returns to originating control.
- Use native-feeling microinteraction: hover/press, message selection, subtle highlight for linked message, predictable context menus, reasonable 120–220ms animations with reduced motion.

## F. Mobile chat — first-class, not a squeezed rail

Phone: chat **opens a full-page route**, not a permanent right panel reducing content to 150px. Conversations list and conversation page are distinct stages, with a predictable back button and deep-linking. If Stream is active, toggling chat uses a switchable room subview or full page with a clear Return to Stream; preserve ongoing media session and indicate active mic/camera state.

The composer follows the **visual viewport** when software keyboard opens; safe-area padding accounts for home indicator and notch, attachment tray does not cover Send or recorded media controls. For long attachments and multi-line text, composer grows to a cap and message list shrinks correctly. Touch selection, link previews (if any), scroll restoration and unread marking tested on real iOS/Android.

Tablet: prefer either split conversation list and detail or adjustable conversation pane, never stack excessive overlays.

## G. The automation-to-chat bridge

Agents are communication workflows and can deliver internal updates where supported. The shared chat design must make automated posts understandable:
- Author identity: e.g. `Daily Team Brief · Automation`, distinct icon/badge from individual user.
- Context: source/agent name, scheduled or triggered time and links to the agent item and specific execution event when authorized.
- Delivery failures are displayed in agent history and owner notifications, not disguised as user chat bubbles.
- Sender/recipient controls remain in the **Agent Item/Audience** pages. Chat messages may link to that item but do not become a second configuration interface.
- Company-wide access and member/channel privacy maintained server-side. A user's personal notification preferences must be separate from an agent's organization-level schedule.

## H. Collaboration and presence

Identity: global user profile vs per-company member profile; avatar, presence, name and role display use consistent data. Distinguish **online**, **in room**, **typing**, and **recording** only if presence signals are actually implemented/reliable; do not fake status. Avoid camera feed as default avatar unless user intentionally goes live and has granted permissions. Use sensible thumbnail/fallback behavior when camera unavailable.

Activity/history: task change logs, agent execution events and chat messages are **separate records** with common visual status language and meaningful cross-links, not forced into one undifferentiated feed. Ensure no sensitive chat content leaks into public task activity or push/email notification snippets without authorization.

## I. Reliability, safety, permissions and theme

- Tenant isolation and membership enforced server-side on every conversation, message, attachment and stream subscription; removing a user must revoke access appropriately.
- Permission filtering applies to global search, message previews, unread counts and deep-link lookups.
- SSE/WebSocket reconnection deduplicates events and restores delivery state; avoid unread count drift and race conditions when multiple tabs open.
- Never report delivery/read state not guaranteed by backend; missing signal is unknown, not 'read'.
- Rate limits, upload validation, filename escaping and sanitized content remain intact. Safe handling for pasted HTML and link previews.
- Theme inheritance: every supported theme/density applies to chat lists, bubbles, composer, menus, avatars, status badges and typing indicators, with contrast and focus parity. Stream video content has reliable control overlays across light/dark themes.
- Browser push/email notification behavior is opt-in and follows existing permissions; avoid promising cross-device delivery until verified.

## J. Required acceptance journeys / tests

1. From Work task page open chat dock, compose draft, open another task and return: draft and conversation persist.
2. Open chat focus page from header; move through conversations; browser Back restores previous workspace scroll and selected collection.
3. Open notification/mention (where supported): exact authorized conversation and message scroll anchor loads.
4. Resize dock or enter Email Studio; chat doesn't cover work or lose messages, and returns predictably.
5. Mobile keyboard and safe areas: message list scroll, multi-line composer, Send and attachments remain reachable on real Android/iOS.
6. Stream ongoing mic/camera remains correct across Chat/Room surface switches and background/foreground transitions permitted by platform.
7. Agent posts internal brief with clearly automated attribution and working authorized links to agent and event.
8. Network drops during send: clear pending/error state, safe resend without duplicate server messages.
9. User removed from company: conversation history and activity no longer exposed through route, search, cache or event stream.
10. No fake online/read/delivery status; race/reconnect/unread tests; assistive tech and all existing themes/densities.
11. Legacy message history and Stream collaboration functionality preserved after navigation redesign.

## K. Implementation milestones

**C0 Audit:** actual chat/Stream capabilities, storage, subscriptions, permissions, mobile behavior and screenshot baseline. **C1 Shell:** global chat affordance, dock/full route semantics and state retention. **C2 Chat experience:** message header/list/composer, responsive rules, keyboard and scroll quality. **C3 Stream/automation connections:** intentional links, media preservation and message attribution. **C4 Hardening:** offline/reconnect, accessibility, multitenancy and theme regression. Ship in small reversible PRs; do not replace the existing chat transport solely to achieve visual consistency.
