# Agents Management — UI Design

## 1. Agents home

The home surface is management + activity.

```text
AGENTS                                              [ + Add agent ]

ACTIVE AGENTS

Company Newsletter
Monthly · First Monday · 9:00 AM
328 customers · Next: Nov 2
[ Open ]

New Customer Welcome
When contact becomes Customer · wait 1 day
12 sent this month
[ Open ]

──────────────────────────────────────────────────────────────

ACTIVITY

Tomorrow · 9:00 AM
Company Newsletter
Auto-emailing 328 customers
SCHEDULED

Today · 2:14 PM
New Customer Welcome
Auto-emailed Sarah Martinez
SENT

Yesterday · 4:40 PM
Review Request
FAILED — missing recipient email
[ Open ]
```

### Requirements

- Active and draft Agents appear above the river.
- Activity river mixes future and past events.
- Infinite scroll history.
- Upcoming events appear naturally in chronological order.
- Failures are visually prominent.
- Each activity item identifies:
  - Agent,
  - action,
  - target/recipient count where applicable,
  - time,
  - state.
- Clicking an activity item opens the Agent with that event selected or a dedicated event detail panel.
- Calendar may deep-link into the exact same event.

## 2. Add Agent

`+ Add agent` opens the built-in catalog.

```text
ADD AGENT

Scheduled
[ Company newsletter ]
[ Sales catalog ]
[ Internal messages ]

Follow-ups
[ Welcome a new customer ]
[ Ask for a review ]
[ Check in after no reply ]
[ Follow up after a status change ]
[ Check in after a job or service ]

Manual
[ Company announcement ]
[ Special offer ]
[ Event invitation ]
[ Important customer notice ]
[ New product or service ]

Social
[ Weekly social post ]
[ Product or service spotlight ]
[ Company update ]
[ Promotion schedule ]
[ Post an announcement ]
[ Promote a product or service ]
[ Share something with followers ]
```

Selecting a built-in type immediately creates a draft Agent and opens its editor.

No pre-create wizard.

## 3. Agent editor

The editor is a stable shell. The Agent type decides which controls appear.

### Shared header

```text
← Agents

October Newsletter                               DRAFT

[ Send test ]                              [ Publish ]
```

### Message area

Scheduled Agents may own multiple messages.

```text
MESSAGES

October newsletter       READY
November newsletter      DRAFT
December newsletter      EMPTY

[ + Add message ]
```

Selecting a message opens the editable message surface.

The user can cycle through messages without leaving the Agent.

### Message editor

```text
Subject
[ October news from {{company.name}} ]

[ editable message body / email canvas ]

Template   [ Newsletter ▾ ]
Theme      [ Company ▾ ]
```

Rules:

- Template and Theme selectors stay in consistent positions.
- Template switching updates the live message in place.
- Theme switching updates the live message in place.
- No side-by-side preview requirement.
- Content should survive template/theme changes wherever structurally possible.
- Plain-text is a first-class email option.
- At least one visually distinctive HTML email template should exist in V1.

### Agent controls

Example: Company Newsletter

```text
DELIVERY

Recipients   [ Customers ▾ ]
Repeat       [ Monthly ▾ ]
Day          [ First Monday ▾ ]
Time         [ 9:00 AM ▾ ]

328 matching contacts
Next delivery: Nov 2 · 9:00 AM
```

Example: New Customer Welcome

```text
DELIVERY

When         [ Contact becomes Customer ▾ ]
Wait         [ 1 ] [ Day ▾ ]
Send         [ Once ▾ ]

41 contacts became customers this month
```

The controls are plain fields, not sentence-builder prose.

## 4. Event detail

An execution event should show the frozen facts for that event.

```text
Company Newsletter
Auto-emailing 328 customers

SCHEDULED
Nov 2 · 9:00 AM

Message
October Newsletter

Recipients
328 currently selected

Channel
hello@company.com

[ Edit agent ] [ Cancel event ]

Preview
...
```

When active:

```text
RUNNING

32 sent
296 remaining

[ Stop ]

Failures
...
```

When complete:

```text
COMPLETED

326 sent
2 failed

[ Open failures ]
```

For the MVP/POC:

- fail fast,
- retry only transient provider errors, bounded and visible (07 decision 7),
- surface persistent failures loudly.

## 5. Test send

Every email Agent supports `Send test`.

V1 behavior:

- default target is the current user's connected/test email,
- render using representative sample data,
- do not enroll a Contact,
- do not create a normal delivery event,
- store enough diagnostic information to investigate delivery failures.

## 6. Contacts and Calendar entry points

Contacts may expose granular shortcuts such as:

- Start this Agent for selected contacts
- Use selected contacts with a Manual Agent

Calendar displays upcoming/past Agent events.

Neither surface replaces Agents.

No additional slide-over or duplicate management UI is required in V1.
