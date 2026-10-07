# Agents Management — Built-in Agent Types and Rules

## Philosophy

The product does not expose a generic workflow engine for the common case.

Each built-in Agent type supplies:

- allowed channel,
- default template,
- default theme,
- allowed recipient controls,
- allowed rule controls,
- validation rules,
- event-generation behavior.

The user customizes an instance.

## Email — Scheduled

### 1. Company newsletter

Purpose: recurring company news and useful customer updates.

Controls:

- Recipients
- Repeat
- Day
- Time

Messages:

- N queued messages
- next ready message is used for the next scheduled event

### 2. Sales catalog

Purpose: recurring product/service selection or sales content.

Controls:

- Recipients
- Repeat
- Day
- Time

Content may reference Inventory.

Messages:

- N queued catalog messages
- shared template/theme recommended across messages

### 3. Internal messages

Purpose: recurring internal team notices.

Controls:

- Recipient group
- Repeat
- Day
- Time

V1 should keep recipient options simple.

## Email — Follow-ups

### 4. Welcome a new customer

Initial trigger:

- Contact becomes Customer

Controls:

- Wait
- Send once

### 5. Ask for a review

Initial trigger:

- Contact becomes Customer OR supported completed-service milestone later

Controls:

- Wait
- Send once

Requirements:

- Google review URL may be included.
- Do not implement Yelp review solicitation as an equivalent workflow without policy review.
- automatic dedupe is mandatory.

### 6. Check in after no reply

Initial trigger:

- supported inactivity state

Controls:

- Wait / age threshold
- Send once

V1 may defer if reliable reply tracking does not yet exist.

### 7. Follow up after a status change

Trigger:

- selected Contact status change

Controls:

- Status
- Wait
- Send once

### 8. Check in after a job or service

Trigger:

- supported completed-service marker later

Controls:

- Wait
- Send once

May remain disabled until the relevant source event exists.

## Email — Manual

### 9. Company announcement

Purpose: one-time company news.

Controls:

- Recipients
- Message
- Send now / choose time

### 10. Special offer

Purpose: one-time promotion.

Controls:

- Recipients
- Message
- Send now / choose time

### 11. Event invitation

Purpose: one-time event invite.

Controls:

- Recipients
- Message
- Send now / choose time

### 12. Important customer notice

Purpose: one-time service/policy/required-action notice.

Controls:

- Recipients
- Message
- Send now / choose time

### 13. New product or service

Purpose: one-time launch/introduction.

Controls:

- Recipients
- Message
- optional Inventory reference
- Send now / choose time

## Social — Scheduled

### 14. Weekly social post

Controls:

- Connected social channel(s)
- Repeat
- Day
- Time
- queued posts

### 15. Product or service spotlight

Controls:

- Channel(s)
- Inventory selection/source
- Repeat
- Day
- Time
- queued posts

### 16. Company update

Controls:

- Channel(s)
- Repeat
- Day
- Time
- queued posts

### 17. Promotion schedule

Controls:

- Channel(s)
- Repeat / interval
- start
- end or number of posts
- queued posts

## Social — Manual

### 18. Post an announcement

Controls:

- Channel(s)
- Post content
- Post now / choose time

### 19. Promote a product or service

Controls:

- Channel(s)
- Inventory item
- Post content
- Post now / choose time

### 20. Share something with followers

Controls:

- Channel(s)
- Post content
- Post now / choose time

## Phase boundaries

Email setup establishes the core patterns first.

Social should be added with the smallest possible blast radius:

- reuse Agent,
- reuse AgentMessage,
- reuse AgentEvent,
- replace recipient audience with connected social destinations,
- expose only platform-supported capabilities,
- do not introduce a second automation model.
