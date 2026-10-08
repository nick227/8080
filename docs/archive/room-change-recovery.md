# Room change recovery

Room item pages include `meta.changeCursor`, read in the same repeatable-read
snapshot as the items. Start SSE with `/rooms/{id}/stream?cursor={changeCursor}`.
Every item event carries a hydrated `item`, a `cursor`, and an SSE `id` equal to
that cursor. Reconnecting EventSource clients send `Last-Event-ID`, which takes
precedence over the initial URL cursor. Cursors are room-specific sequences, not
item numbers. A connection without a cursor receives only subsequent changes.

Creates, reaction additions/removals, and deletion of every shared placement
append journal entries in their mutation transaction. Failed transactions leave
neither mutations nor journal entries. Deletions remain `item.updated` events
with tombstoned items. The journal stores identifiers only; replay hydrates
current state, not historical content or expiring media tokens. Multiple changes
to one item can therefore replay the same current state. Payload reactions are
personalized for the authenticated viewer.

Readers poll once per second and drain backlogs in batches of 100. Nearby readers
at the same cursor share batch database reads for 250ms. Database polling also
finds commits from other server processes and survives restarts without an
in-memory delivery queue. Access is checked on every batch; slow connections are
closed and can resume. Presence events still use the existing process-local hub.
The journal currently has no retention cutoff; future pruning must introduce an
explicit expired-cursor recovery protocol before removing entries.

The SDK merges events directly, ignores duplicate cursors, and keeps the cursor
with cached history across room remounts. It buffers events during page fetches
so the fetch cannot overwrite live changes. Reconnects do not reset older pages.

Apply the additive Prisma schema update before running this version:
`pnpm --filter @project/db db:push` (the server start script already runs this).
Existing rooms start at change cursor zero; no historical backfill is needed
because clients obtain their baseline from the item snapshot. Deploy the server
and regenerated SDK together because older ID-only SSE consumers use different
recovery semantics.
