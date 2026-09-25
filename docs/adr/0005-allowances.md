# A user's allowance is tokens per month, counted by Foundry

Date: 2026-09-17
Amended: 2026-09-20, 2026-09-21

## Context

Foundry's model access is a shared **pool**: credentials the company owns, used
by everyone. That makes one question load-bearing — how does one person's usage
stop being everyone's problem? — and it makes a second one unavoidable, since
the pool is finite: what does a user see when the pool, not their own budget, is
what ran out?

CLIProxyAPI cannot answer either. Its client keys are opaque strings with no
identity, its usage records go to an in-memory queue (60s default retention, no
disk persistence), and open bugs report streaming usage stuck at all-zeros. It
curates models per credential, not per caller, so even model restriction is not
its job. Its own records are useful as a cross-check against ours and nothing
more.

What makes this tractable is that the Foundry server is _in the path_. pi points
its provider `baseUrl` at Foundry, so every request body and every response frame
passes through code we own. Counting is not a matter of asking anyone: it is a
matter of counting the bytes already in hand.

## Decision

**The ledger is raw facts, not counters.** One row per completed request — user,
model, input tokens, output tokens, cache read, cache write, timestamp, outcome.
Windows, totals and any future cost estimate are queries over those rows. A
counter would commit us to one window and one unit before we know which we want,
and there is no way to un-roll a sum.

**A refusal is a fact too.** A request Foundry turns away — for the allowance, or
because the pool refused it — is written as a row with zero tokens and the reason
it was turned away, so "who is being refused, and why" is one query. It is also
the only durable record of a pool refusal: the proxy keeps its own usage in
memory for a minute and nothing on disk. Nothing is charged either way, and the
pre-flight check runs before the request is sent to the pool, so a refusal cannot
spend.

**An allowance is a number of tokens per calendar month**, measured as input plus
output with cache reads recorded separately. The month is WIB — `Asia/Jakarta` in
the server's config, so it turns over at Jakarta midnight, which is when the
people subject to it expect it; Indonesia has no daylight saving, so the boundary
is a fixed offset rather than a moving one. A default applies to every user and a
per-user row overrides it, so nobody is ever unbudgeted and "how much does this
person get" is one editable number — the default from config beside the boundary,
the override a row, and clearing the row is how someone returns to the default.
Not dollars: inside a subscription pool no unit price is real, so a dollar figure
would be an invented exchange rate. Not a share of the pool either, because the
pool's remaining capacity is not something Foundry can see reliably — absolute
numbers are the honest shape.

**Fair share needs a second, faster guard, and it is owed.** A monthly ceiling
cannot stop one person with eight parallel chats from consuming the afternoon's
capacity and still being under budget. So a per-user cap on simultaneous turns
belongs alongside it, and that cap is what would actually hold the pool steady. It
was not built, because a legitimate fan-out — one session driving several
subagents — meets any cap chosen for human chat habits, and no such fan-out
existed then. **One does now**: a person starts several runs at once on the
desktop (ADRs 0012, 0013), so the cap is taken up there rather than deferred,
and what it bounds is one person's own fan-out. The argument above stays true and the risk is accepted
rather than solved: until the cap exists, a burst can take the pool's afternoon
and the ceiling will not see it.

**Enforcement is pre-flight, with bounded overshoot accepted.** Before the call:
input estimate plus the request's `max_tokens` ceiling — the catalog's limit for
that model where it states one, and pi's own 16384 otherwise, so a request that
leaves the field out is measured rather than waved through. On completion: the
actual total, written to the ledger. Concurrent turns can each pass the check and
then overshoot together; that is accepted rather than solved, because reservation
and reconciliation machinery buys exactness we do not need to protect a pool.

**At the allowance: warn, then refuse.** A warning at 80%, surfaced in the app,
and a hard refusal at 100%. Hard, because a ceiling that does not actually stop
anything is not a guard. The operator's recourse is the same number that caused
it.

**Two refusals, told apart.** `allowance_exceeded` means _this is about you_ and
the remedy is asking for more; it is a 403, terminal and outside every client's
retryable set, so nobody backs off and retries a wall that only moves next month.
The pool being spent means _this is not about you_: it keeps whatever status the
provider gave it, `Retry-After` and all, because waiting is the remedy there, and
it carries the provider's own cooldown, so the honest answer can be "the shared
subscription resets at 2pm". A user who cannot distinguish them will report the
tool as broken. Both are carried in OpenAI's error envelope
(`{"error":{"message","type","code"}}`), because `/v1/*` is an OpenAI-compatible
surface and pi parses those shapes — with Foundry's codes inside it.

**One Foundry key to CLIProxyAPI.** Foundry already knows the caller from the key
presented, so minting a proxy key per user would couple a user's lifecycle to
CLIProxyAPI's config file in exchange for attribution we already hold.

**Users see their own usage** at `GET /api/usage`, authenticated by the key that
identifies them: month-to-date against their allowance, the window, whether they
are warned, and what they were refused. Whether the allowance is their own number
or the default comes back with it, so whichever surface shows it can say which of
the two applies. The ledger computes all of it as a query. An allowance only reads as fair when
the person subject to it can see it, so both surfaces show it: the window draws the
month in the chat's own composer — a bar beside the box, the warning under it, and a
refusal taking that line when one arrives, because the refusal is what the reader has
to act on — and the console shows an operator the same reading for a person, with
their override beside it.

**An operator sees anyone's, and sets the overrides.** Foundry's own admin routes
answer a person's usage and their refusals and set or clear an override,
authorized by the console's Better Auth session carrying the `admin` role — the
credential the console already holds, where the desktop holds a key. Two kinds of
credential on one server is honest: they are different callers.

**One database, two owners.** Better Auth reads and writes the user, session,
account and verification tables; Foundry writes the ledger. They share one
database rather than living in two, because that is what lets a usage row carry a
real reference to a user at all — a foreign key cannot point from one database
into another ([0009](0009-postgres.md)). One store is the whole of the
technical claim; how its tables are described has moved on since this was
written, and no longer involves anyone hand-writing them.

## Consequences

Overshoot is real and documented rather than eliminated: a user near their
allowance can exceed it by the tokens their concurrent turns have already
requested. The affected window is a conversation, not a month.

A refusal leaves a row where nothing was spent, so a query over the ledger has to
say what it means by usage: the outcome column is what tells a spend from a
refusal.

Nothing here prices a token, so an allowance is a fairness number rather than a
charge. A rate card, if ever wanted, is a query over rows that already exist.

Per-user **model** restriction is deliberately not built. It would be ours to
enforce, and nobody has asked for a limited user yet; it belongs on the allowance
row when someone does. Until then, every user sees the whole catalog served by
`GET /api/models`.

A user cannot be told _why_ the pool is short — the upstream cooldown arrives,
but the credentials behind it are the company's business.

## Considered options

**Rolled-up counters** — cheaper to read, and a migration the first time the
window or unit changes. Rejected as the primary representation; a periodic
roll-up over the rows stays available if reading them ever gets expensive.

**Cost in dollars** — familiar, and it would show a number people recognise.
Rejected because in a subscription pool the price is an assumption, and a wrong
number invites decisions based on it.

**Reservation and reconciliation** — exact enforcement. Rejected for v1 as
machinery larger than the problem; revisit if allowances ever become a charge.

**Counting only what the upstream reports** — free, since the value arrives in
the response. Rejected as the authority because of the known streaming-usage
bugs; a non-zero upstream figure is used as a correction, and pi's own per-turn
usage object is never the authority because it is client-side and spoofable.

**A CLIProxyAPI key per user** — would give per-user attribution inside the
proxy. Rejected: our own auth already identifies the caller, and the queue that
data lands in does not persist.

## Revisit when

Allowances become something users pay for, the pool stops being one pool, or a
session starts driving a fan-out of subagents that the run cap does not count.
