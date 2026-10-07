# Agents Management — Product Overview

## Purpose

Agents is the communication automation surface for the workspace.

It is not a general workflow builder and it is not an email client.

The product model is intentionally small:

- **Agent** — the primary thing a user creates and manages.
- **Agent Type** — one of a small set of built-in communication behaviors.
- **Message** — one piece of content owned by an Agent.
- **Execution Event** — one past or future action performed by an Agent.
- **Template** — layout + starter content for a message.
- **Theme** — reusable visual tokens applied to a template.
- **Channel Connection** — an authenticated delivery destination such as Gmail, Facebook, Instagram, LinkedIn, etc.

The user should rarely need to think about schedules, runs, queues, triggers, or workflow nodes. Those are implementation concepts behind the Agent.

## Product principle

**The Agent owns the behavior. Messages own the content. Templates own the layout. Themes own the visual system. Execution Events record what happened or will happen.**

## Agents page

The top-level Agents surface has only three major jobs:

1. Show active and draft Agents.
2. Let the user add a new Agent from the built-in set.
3. Show an infinite chronological activity river of upcoming, active, completed, canceled, and failed Agent events.

There are no top-level tabs for Runs, Library, Automations, or History.

Calendar may show the same execution events as another temporal view, but Agents is the authoritative management surface.

## Agent families

Initial families:

### Scheduled

Recurring or time-based communication.

Initial email Agents:

- Company newsletter
- Sales catalog
- Internal messages

Initial social Agents:

- Weekly social post
- Product or service spotlight
- Company update
- Promotion schedule

### Follow-ups

Contact-driven communication.

Initial Agents:

- Welcome a new customer
- Ask for a review
- Check in after no reply
- Follow up after a status change
- Check in after a job or service

Initial supported trigger concepts:

- Contact status change
- New customer
- 90-day timer

### Manual

One-time mass communication that still benefits from saved Agent configuration and reusable content.

Initial email Agents:

- Company announcement
- Special offer
- Event invitation
- Important customer notice
- New product or service

Initial social Agents:

- Post an announcement
- Promote a product or service
- Share something with followers

## Built-in Agent types

Built-in types are reused as new Agent instances.

The user does not create workflow definitions for the common case.

Example:

- Built-in type: `company_newsletter`
- User instance: `October Newsletter`
- Another user instance: `Monthly Customer Update`

Both use the same behavior definition but own different messages, audience settings, timing, template, and theme.

A generic Custom Agent may exist later, but it should not be prominent in V1.

## Interaction language

Use plain business language.

Preferred:

- Add agent
- Publish
- Pause
- Send test
- Message
- Recipients
- Repeat
- Day
- Time
- Next delivery
- Auto-emailing
- Auto-posting
- Failed

Avoid exposing:

- Trigger
- Cadence
- Node
- Workflow
- Automation graph
- Execution engine
- Event source
- Delivery job

## AI role

AI is optional and bounded.

AI may:

- help understand a user's intent,
- write or rewrite message text,
- generate starter copy,
- suggest short custom text,
- help adapt content to a selected template.

AI does not:

- generate IDs,
- choose recipients without explicit deterministic rules,
- manage schedules,
- decide permissions,
- send or publish,
- calculate dates or counts,
- retry failed deliveries,
- mutate contact or inventory state.

The Agent must be fully inspectable and executable without AI.
