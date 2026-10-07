# Agents Management — Email Delivery Requirements

## Goal

Establish the communication Agent pattern using email first.

This document focuses on delivery behavior rather than provider-specific authentication.

## Channel setup

Email connection setup is separate from Agents.

The workspace may have one or more connected sending accounts.

An Agent references one connected account.

The Agent editor should show the selected sender clearly.

## Rendering

Each email is composed from:

- AgentMessage semantic content,
- MessageTemplate layout,
- MessageTheme tokens,
- deterministic merge variables,
- recipient/contact data.

Merge variables must be from a product-defined allowlist.

Examples:

- `contact.firstName`
- `contact.fullName`
- `company.name`
- `company.website`
- `company.googleReviewUrl`
- selected Inventory fields where explicitly supported

No arbitrary expression language in V1.

## Message queue behavior

Scheduled Agents may contain N messages.

A message has:

- EMPTY
- DRAFT
- READY

A scheduled execution requires an eligible READY message.

If no READY message exists:

- do not improvise,
- do not call AI automatically,
- surface the Agent as blocked,
- create a visible failure/blocker event.

## Scheduling

V1 supports exact times.

No quiet-hours abstraction.

No implicit business-hours shifting.

Examples:

- every month,
- first Monday,
- 9:00 AM,
- once at a selected time,
- wait N days after a supported Contact event.

Workspace timezone must be explicit.

## Recipient resolution

Recipients are primarily organized in Contacts.

V1 Agent options may select only simple recipient sources, such as:

- Customers
- Leads
- All contacts
- a small supported saved group/list later

Advanced list construction remains in Contacts.

Shortly before execution:

1. resolve current eligible contacts,
2. suppress duplicates,
3. validate required address fields,
4. render merge variables,
5. freeze concrete delivery payload,
6. execute.

## Editing

Agents and future messages remain editable as long as possible.

V1 does not maintain a user-visible version tree.

Once a concrete delivery has begun, its frozen payload does not change.

Editing the Agent affects future events only.

## Failures

POC/MVP philosophy:

- fail visibly,
- fail fast where possible,
- no hidden retries: only transient provider errors retry, bounded (max 3) and visible per attempt (07 decision 7).

Examples:

- invalid/missing recipient address,
- provider authentication failure,
- provider rejection,
- missing ready message,
- unsupported template capability.

Failures must appear:

- on Agents home activity river,
- on the Agent detail,
- on the specific event detail.

## Send test

`Send test` should:

- render the selected message,
- use representative/sample merge data,
- send to the current user's selected test address,
- not change Contact state,
- not count as an ordinary recipient delivery,
- clearly label the email as a test where appropriate.

## Unsubscribe/compliance

Before production-scale bulk email, the product will need an explicit compliance review covering:

- consent and lawful basis,
- unsubscribe handling,
- suppression lists,
- sender identification,
- physical address requirements where applicable,
- provider policy requirements,
- bounce handling.

Do not infer that normal transactional/follow-up email and marketing bulk email have identical compliance requirements.

This is a required production hardening area, not optional polish.
