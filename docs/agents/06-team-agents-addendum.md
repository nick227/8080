# Agents Management — Team Agents Addendum

## Decision

Add a new **Team** Agent family with two built-in Agents:

1. **Daily Team Brief**
2. **Daily Customer Report**

Both Agents deliver to the same internal audience through two destinations:

- **External email** — sent to the email addresses of workspace users.
- **Internal chat** — posted into the workspace's shared company chat.

There is no separate Team contact list in V1.

The workspace membership list is the audience. Each user's signup email is their external email destination.

---

## Product principle

Team Agents are normal Agents.

They reuse the same Agent lifecycle, scheduling, message, template, theme, event, and history concepts already defined for communication Agents.

The only important difference is the recipient source:

```text
Customer Agent  → Contacts
Social Agent    → Connected social channels
Team Agent      → Workspace members
```

For these two Team Agents, the default delivery destinations are:

```text
Workspace members → Email + Company chat
```

Do not create a second internal automation system.

---

# 1. Team Agent family

The Add Agent surface gains one additional family:

```text
TEAM

[ Daily team brief ]
[ Daily customer report ]
```

Selecting either built-in Agent immediately creates a Draft Agent and opens the normal Agent editor.

No setup wizard is required before creation.

---

# 2. Daily Team Brief

## Purpose

Send the team a concise morning view of what matters today.

The brief should use workspace data the product actually owns.

Potential sections can include:

- today's calendar items,
- upcoming deadlines,
- important recent workspace activity,
- failed Agents requiring attention,
- low inventory alerts,
- other explicitly supported operational facts.

V1 does not need every section.

The implementation should start with a small set of reliable sections and grow as more workspace data becomes available.

## Default behavior

```text
Agent type      Daily Team Brief
Audience        Workspace members
Destinations    Email + Company chat
Repeat          Daily
Time            User-configurable
Status          Draft until published
```

Suggested default time:

```text
8:00 AM workspace time
```

The user may change the time.

## Editor controls

Keep configuration small:

```text
Daily Team Brief

Send to        [ Workspace members ]
Deliver by     [ ✓ Email ] [ ✓ Company chat ]
Repeat         [ Daily ▾ ]
Time           [ 8:00 AM ▾ ]
Sender         [ Send with 8080 ▾ ]  (or an own-mailbox SMTP connection)

Include
[ ✓ Important activity ]
[ ✓ Agent failures ]
[ ✓ Low stock alerts ]
[ ✓ Follow-ups due ]

12 team members will receive this

[ Send test ]                         [ Publish ]
```

> **Sender Note**: Team Agents can send via the default workspace platform sender ("Send with 8080" via Resend) or an authenticated own-mailbox SMTP connection configured in `Company → Integrations`. Agent execution logic remains completely provider-agnostic.

The available `Include` options must be product-defined.

Do not expose a generic report/query builder.

## Content

The system may provide a default brief layout.

Template and Theme remain available where appropriate:

```text
Template       [ Team brief ▾ ]
Theme          [ Company ▾ ]
```

The email and internal-chat versions may render differently while representing the same underlying brief.

For example:

- email may use a compact HTML layout,
- internal chat may use native structured message blocks.

The underlying facts should be the same.

---

# 3. Daily Customer Report

## Purpose

Give the team a daily summary of customer/contact activity and items that need attention.

This is an internal operational report, not a customer-facing message.

## Initial report content

Use deterministic workspace data.

Good V1 sections include:

- new contacts/customers today,
- recent Contact status changes,
- follow-ups due,
- contacts requiring attention,
- notable Contact activity supported by the current CRM model.

Optional later sections:

- customers with no recent activity,
- customer-related Agent failures,
- service/job completion activity,
- sales or revenue metrics when trustworthy source data exists.

Do not invent financial or customer-performance metrics that the workspace cannot currently calculate.

## Default behavior

```text
Agent type      Daily Customer Report
Audience        Workspace members
Destinations    Email + Company chat
Repeat          Daily
Time            User-configurable
Status          Draft until published
```

## Editor controls

```text
Daily Customer Report

Send to        [ Workspace members ]
Deliver by     [ ✓ Email ] [ ✓ Company chat ]
Repeat         [ Daily ▾ ]
Time           [ 5:00 PM ▾ ]

Include
[ ✓ New customers ]
[ ✓ Status changes ]
[ ✓ Follow-ups due ]
[ ✓ Needs attention ]

12 team members will receive this

[ Send test ]                         [ Publish ]
```

The report should show useful metadata in the editor when available:

```text
Today
8 new contacts
3 status changes
5 follow-ups due
```

These are live calculations, not editable content.

---

# 4. Team audience

## V1 audience rule

Every active workspace user is part of the Team audience.

External email delivery uses the email address associated with that user's workspace/account membership.

Conceptually:

```text
Workspace
  └── Members
        ├── Alice → alice@company.com
        ├── Bob   → bob@company.com
        └── Carol → carol@company.com
```

No duplicate Team Contacts are created in CRM Contacts.

No separate mailing list is required.

## Eligibility

A workspace member is eligible for external email when:

- membership is active,
- a valid account email exists.

A workspace member is eligible for internal chat when:

- membership is active,
- they can access the workspace/company chat.

If one delivery destination is unavailable for a member, the other may still succeed.

---

# 5. Delivery model

One Team Agent event may fan out into two channel deliveries.

Example:

```text
Daily Team Brief
Oct 8 · 8:00 AM

Company chat        POSTED
External email      11 sent · 1 failed
```

The user should still experience this as one Agent event.

Avoid creating separate visible Agents for:

- Daily Team Brief — Email
- Daily Team Brief — Chat

The destinations are delivery options on one Agent.

---

# 6. Internal chat behavior

Internal chat should receive a native Agent activity/message rather than an email-shaped blob.

Example:

```text
DAILY TEAM BRIEF

Today · October 8

3 calendar items
2 follow-ups due
1 Agent needs attention
4 inventory items below minimum

[ View calendar ]  [ View activity ]
```

Requirements:

- identify the posting Agent,
- identify that the message was system/Agent generated,
- allow useful deep links,
- do not impersonate a human workspace member,
- do not require AI to generate the post.

The chat message can be deterministic and structured.

AI may optionally improve short summary prose later.

---

# 7. External email behavior

The same report can render as a normal branded internal email.

Requirements:

- recipient is the workspace member's account email,
- sender uses the configured workspace email connection,
- Template and Theme may be applied,
- plain-text fallback is supported,
- each recipient's rendered email is frozen when execution begins,
- failures appear in Agent activity.

Team email is operational internal communication, but it still uses the same delivery provider infrastructure as other email Agents.

---

# 8. Scheduling

Both Team Agents use exact workspace-local scheduling.

V1:

```text
Repeat     Daily
Time       HH:MM
```

No quiet hours.
No randomized delivery.
No AI scheduling.

A future phase may add:

- weekdays only,
- weekly team reports,
- per-team destinations,
- role-specific reports.

These are explicitly outside this addendum's V1 scope.

---

# 9. Suggested schema additions

The existing Agent schema should require little or no structural change.

## Agent recipient config

Team Agents use a bounded recipient source:

```json
{
  "source": "WORKSPACE_MEMBERS"
}
```

No Contact IDs are stored as the Team audience definition.

## Delivery destinations

Add or formalize a bounded Agent delivery configuration:

```json
{
  "destinations": [
    "EMAIL",
    "INTERNAL_CHAT"
  ]
}
```

This may live in `deliveryConfig` rather than `recipientConfig` if that keeps responsibilities cleaner.

Suggested Agent shape:

```text
Agent
- id
- workspaceId
- typeKey
- family
- name
- status
- recipientConfig
- deliveryConfig
- ruleConfig
- templateId?
- themeId?
- ...
```

For these two Agents:

```text
family = TEAM
recipientConfig.source = WORKSPACE_MEMBERS
deliveryConfig.destinations = [EMAIL, INTERNAL_CHAT]
```

## AgentEvent

One event represents the logical Team Agent execution.

Per-destination outcomes may be stored separately.

Example:

```text
AgentEventDelivery
- id
- agentEventId
- destinationKind      EMAIL | INTERNAL_CHAT
- status               PENDING | RUNNING | COMPLETED | FAILED
- targetCount?
- successCount?
- failureCount?
- failureSummary?
- startedAt?
- completedAt?
```

Email may still use `AgentEventTarget` for individual workspace-member delivery status.

Internal chat will usually have one workspace-chat target.

---

# 10. Activity river

Team events appear in the same Agents activity river.

Examples:

```text
Today · 8:00 AM
Daily Team Brief
Emailed 12 team members · Posted to company chat
COMPLETED
```

```text
Today · 5:00 PM
Daily Customer Report
Email failed for 1 team member · Posted to company chat
FAILED
```

```text
Tomorrow · 8:00 AM
Daily Team Brief
Emailing 12 team members · Posting to company chat
SCHEDULED
```

Failures should remain loud and inspectable.

---

# 11. AI boundaries

AI is not required to build either report.

Code owns:

- report section selection,
- source queries,
- calculations,
- dates,
- recipient membership,
- email addresses,
- scheduling,
- rendering inputs,
- delivery,
- persistence,
- failure state.

AI may optionally:

- write a short opening summary,
- condense deterministic facts into one or two natural-language sentences.

If AI is unavailable, both Agents must still generate useful reports.

---

# 12. V1 acceptance requirements

## Daily Team Brief

A user can:

1. create the Agent from `Add agent`,
2. choose Email, Company chat, or both,
3. choose the delivery time,
4. choose from a bounded set of included sections,
5. send a test,
6. publish,
7. receive the report by external email,
8. see the same report posted to company chat,
9. inspect the event in Agents history.

## Daily Customer Report

A user can perform the same flow with customer/contact-specific report sections.

## Shared requirements

- Workspace members are the audience.
- User account email addresses are the Team email list.
- No CRM Contact duplication.
- One Agent execution may deliver to multiple destinations.
- One Agent event remains the user's mental model.
- Email and chat failures are independently visible.
- No hidden retries in the MVP/POC.
- No generic workflow builder is introduced.
- No new top-level Team management surface is introduced.

---

# Resulting Agent families

The product now has four user-facing Agent families:

```text
Scheduled
Follow-ups
Manual
Team
```

For V1, Team contains only:

```text
Daily Team Brief
Daily Customer Report
```

This keeps the expansion narrow while proving that the Agent architecture can support internal company communication as well as customer and social communication.
