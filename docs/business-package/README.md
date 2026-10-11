# Business package format — draft 0.1.0

> Exploratory schema draft, deferred pending the [Blueprint Catalog and Reader](../blueprint-catalog-plan.md). This is not a finalized public contract and is not the current Reader data format. Requirements below describe potential future behavior, not implemented upload, generation or import features.

This format describes a business profile and an optional workspace setup. It is the common contract for manually written files, AI-generated files, future in-app generation, previews, and reviewed imports.

## Downloadable contract

Canonical files are public web assets, ready to be served when the application is deployed:

- [JSON Schema](../../apps/web/public/schemas/business-package/0.1.0.schema.json) → `/schemas/business-package/0.1.0.schema.json`
- [Example package](../../apps/web/public/schemas/business-package/fieldwork-studio.example.json) → `/schemas/business-package/fieldwork-studio.example.json`
- [Generation guide](../../apps/web/public/schemas/business-package/generation-guide.md) → `/schemas/business-package/generation-guide.md`

These are draft assets, not a claim that a deployment or upload/import feature is live. `$id` is a versioned URN to avoid inventing a production hostname. Keep published schema-version files immutable; changes get a new version. The schema uses JSON Schema draft 2020-12. Package version and schema version are separate.

The example is a validation fixture with synthetic content and `UNLICENSED` rights. That is acceptable for private draft validation, but it must fail a public-package publication check. It is not a complete business plan or approved content to feature.

## Modules

| Field | Purpose | Implementation position |
| --- | --- | --- |
| `profile` | Name, business kind, category, offer, audience, description and optional location/site. | Profile detail UI and server publication projection are planned. |
| `plan` | Business summary, acquisition, delivery, operations, assumptions, requirements and review criteria. | Optional now; becomes a native document when imported. |
| `people` | Required roles or named people, responsibilities, and whether they are sample identities. | Match to existing members during review; no automatic accounts, invitations or permission grants. |
| `tasks` | Work to do, completion criteria, checklist, priority, responsibility and references. | Core tasks are server-backed; package adapter still required. |
| `milestones` | Planned outcomes with completion criteria and optional target dates. | Preserve as planned milestones; an adapter is required. Existing milestone work logs describe recorded work, not automatically an equivalent planned entity. |
| `schedules` | Suggested dates/times for tasks or independent events. | Task scheduling fields exist; standalone event handling must be explicit in the importer. |
| `documents` | Portable Markdown document content. | Convert to native block documents with supported-format diagnostics. |
| `budgets` | Planned income/expense amounts for explicit periods. | Schema/preview/preservation only initially; budget workspace features are WIP. |
| `demo` | Sample task progress tied to a fixed preview date. | Preview only; never copied as completed operational work. |

Empty arrays are allowed: a package can begin as a business profile and grow. A blank workspace does not require a package at all.

## Business profile semantics

`profile.kind = example` identifies a fictional/example business. `business` describes an actual business; the value is an author claim, not verification. Do not publish a user upload based solely on this flag. Publication requires an explicit owner action and review of the public fields. Private package contents, team data or workspace records do not become public with a profile.

The product leads with the business's offer, audience, plan and people. “Template” is an optional reuse function, not the site's primary category. Use clear Example business labels without pretending an example is an operating company.

## Validation has three layers

1. **Structure:** validate with the versioned schema, including formats. Reject unknown properties, excessive arrays/strings and invalid field types. The upload boundary has a 2 MiB uncompressed UTF-8 JSON limit; no archives or executable attachments in v1.
2. **Meaning:** validate keys/references, supported currency and precision, dates/timezones, schedule relationships, dependency cycles and content semantics. JSON Schema alone does not establish these facts.
3. **Import capability:** prepare a review report listing each module as Ready to import, Needs mapping, Preserved only, or Unsupported. Schema acceptance never means everything can be operationally imported.

Required semantic rules for the importer:

- Keys are unique within each collection, including budget line keys within a budget and demo task states. All references resolve to the specified collection. Disallow self-dependencies and cycles.
- A task's `scheduleKey` points to a schedule of kind `task`. A milestone's target date is the authoritative milestone target; standalone schedule events do not silently become completed work logs.
- A period's start and end use the same date basis and end is not before start. Resolve relative dates against the explicit start date, using calendar-day arithmetic in the confirmed workspace timezone. If no start date is selected, preserve offsets and keep operational tasks unscheduled.
- Check IANA timezones at setup. Dates are date-only values; local times have no implicit server timezone. Ambiguous/nonexistent local times require an explicit scheduling policy and review rather than silent shifting.
- Dependency/checklist relationships the first adapter cannot represent are reported. Preserve their source data; never silently discard them or claim enforcement that does not exist.
- `people` describe responsibilities. Review maps keys to eligible existing workspace members or leaves work unassigned. A sample identity is never treated as a real user. Importing a person's name does not grant access or send an invitation.
- `plannedAmount` is a nonnegative decimal string. Validate ISO currency codes and their supported decimal precision; calculate using decimal arithmetic. Do not use binary floating-point money calculations. Budget line amounts are totals for their declared period, not recurring payments or unit prices. Income and expense signs come from `kind`. Totals are derived, never trusted from an uploaded total.
- Each budget has one currency. Do not sum across budgets with different currencies or silently convert them. A line linked to several tasks is still counted once; allocation percentages are not implied.
- Sanitize display content, disallow raw HTML execution, and do not fetch author-supplied URLs during validation. URL fields are display/link data, not instructions. AI-generated content has no authority to execute commands or activate integrations.
- Publication additionally verifies author authority, reuse rights, sample labels, publicly allowed fields, and any factual claims needing substantiation. `UNLICENSED` packages remain private drafts.

The schema test script checks structural acceptance and representative structural failures. It is not the production semantic validator or import pipeline.

## Upload and generation flow

`Upload JSON` or `Generate a business setup` → private draft → validation report → editable preview → optional workspace creation or explicit profile publication.

Generation produces only JSON matching this same schema. It does not directly create records. Provide validation errors as paths with fixes, for example `tasks[2].personKey: no person with key "manager"`. Users can revise and revalidate without losing their uploaded source. Keep the draft private by default.

Before workspace creation, show the actual record counts, unresolved people/date mappings and unsupported modules. Budgets initially say **Budget preview — not yet available as workspace budgets**. Preserve budget data with the package/installation receipt and optionally create a clearly labeled plan document; do not imply a budget ledger exists.

## Version and compatibility policy

This is `0.1.0`: a WIP contract, not a stable import promise. Pin the exact schema version in generated output. Reject unsupported versions with a specific message; do not guess a migration. Once external users depend on a published version, retain its schema and define explicit migrations for later versions. Unknown modules must not disappear on round-trip export.

## Check the draft

From the repository root:

```sh
node docs/business-package/check-schema.cjs
```

The checker uses the existing server AJV installation. No new runtime dependency is introduced by this draft.
