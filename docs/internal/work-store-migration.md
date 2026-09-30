# Work-store migration

This records the irreversible data changes that turn Work from a ticket-execution system into a
store of tickets and blockers. The decision is in [ADR 0024](../adr/0024-work-is-a-store-and-skills-do-the-work.md).

## Server migration

`apps/server/migrations/0018_simple_issue_tracker.sql` converts the legacy ticket statuses before it
drops `gate`, `closedAt`, `closure`, and the execution tables. The stored statuses are Draft,
Ready, Running, Needs review, Done, and Won’t do. Blocked is derived from open blockers and is not
stored.

The SQL uses this precedence when mapping legacy tickets:

| Legacy data                                                | Stored status  |
| ---------------------------------------------------------- | -------------- |
| Closed with `closure = 'wontfix'`                          | `wont-do`      |
| Closed otherwise                                           | `done`         |
| `cancelled`                                                | `wont-do`      |
| `todo`                                                     | `ready`        |
| `in-progress`                                              | `running`      |
| `in-review`                                                | `needs-review` |
| Open claim, after status mappings above                    | `running`      |
| Latest run ended without a verdict, after claim mapping    | `needs-review` |
| Question with a source chat, or `gate = 'ready-for-human'` | `needs-review` |
| `gate = 'draft'`                                           | `draft`        |
| Anything else                                              | `ready`        |

The migration removes run transcripts, runs, claims, workers, execution workspaces, deliveries, and
review records. Those records cannot be recovered from the new schema. Ticket identity, content,
assignee, priority, tags, blockers, and planning relationships remain.

## Desktop chat migration

Local thread schema version 17 moves each legacy `ticket_id` association into the chat's explicit
`work_ticket_ids_json` links, preserving any links already there, then drops the legacy column. It
runs when the desktop opens its local store; it does not change the server database.

## Applying the migration

The server applies pending migrations at startup. Do not start it against a development database
while this migration is pending, and do not apply this SQL manually there. Before applying it to a
persistent environment, use the normal release backup and migration procedure and confirm that no
one needs the execution records being removed.

The migration has only been exercised against disposable test databases in this change. The
persistent development database has not been migrated.
