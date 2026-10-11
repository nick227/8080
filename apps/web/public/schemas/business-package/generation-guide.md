# Generate an 8080 business package

Draft format: 0.1.0. Download the companion `0.1.0.schema.json` and `fieldwork-studio.example.json` files and supply them to your generator.

Use the following instructions with your business description:

> Produce a JSON business package conforming exactly to the attached 8080 schema version 0.1.0. Return JSON only. Describe the business plainly: its offer, customers, delivery, people, and work. Use `profile.kind: "example"` for fictional businesses. Do not present invented customers, revenue or activity as real. Include specific tasks with completion criteria, planned milestones, role-based responsibilities and suggested schedules. Use package-local keys and valid references. Dates should be relative calendar-day offsets unless I supply fixed dates. Put hypothetical task progress only in `demo`. Do not invent account IDs, integrations, passwords, email invitations or permission grants. Budget values, if requested, must be decimal strings with a currency, explicit period and written assumptions; label unresearched values as illustrative. Set every budget's `capability` to `planned`. State uncertain business assumptions in the plan. Declare content rights accurately; use `UNLICENSED` if reuse rights have not been chosen. Do not add properties outside the schema.

Tell the generator your business type, services/products, intended customers, location if relevant, available people/roles, planning horizon and any constraints. Review the result yourself before upload or publication.

Generated JSON is a private draft until validated and explicitly used. This file describes the format; the in-app generator and upload/import workflow are planned features.
