# Foundry

Foundry is a desktop agent application. Its own domain language is about people, the
chats they hold with Kira, the work those chats are set to, and the model access that
lets her answer.

## Language

**User**:
A person who signs in to Foundry from the desktop app. Identity comes from the company's
Microsoft Entra ID tenant, and Foundry stores no password of its own.
_Avoid_: Account, member, customer

**Key**:
What the desktop presents to Foundry to prove which user it is, issued by the server
after sign-in.
_Avoid_: Token, API key, session, credential

**Provider**:
A company whose models are served through Foundry — Anthropic, OpenAI. Foundry holds a
provider's subscription login as a credential, and the desktop holds none.
_Avoid_: Vendor, model vendor, registered provider (pi's word for the entry Foundry is
reached under, which holds no credential)

**Credential**:
A model provider's subscription login, held by the server so the desktop never holds
it. A credential authenticates Foundry to a provider; a key authenticates a desktop to
Foundry.
_Avoid_: Account, provider key, provider account

**Pool**:
All the credentials available to everyone, shared rather than assigned to a user. When
the pool is spent, users are refused by the provider and no allowance is at fault.
_Avoid_: Quota, capacity, budget

**Catalog**:
The models Foundry offers, resolved from the pool each time the desktop asks. It describes
what Foundry can serve now, so it grows and shrinks with the pool's credentials rather than
being a statement of what the company subscribes to. The pool's own ranking is the order,
so the first of them is what a chat runs on when nobody has chosen one.
_Avoid_: Model list, registry, models file

**Allowance**:
What one user may take from the pool, in two numbers: tokens spent in a WIB calendar month,
and runs in flight at once. A default applies to everyone and a per-user override replaces
both, so nobody is ever unbudgeted. Everything the person spends comes out of it, whether
they typed it or a run of theirs did. It exists so one person cannot take the pool from
everybody else, not to charge anyone for what they use.
_Avoid_: Quota, budget, limit, plan, tier

**Usage**:
What one user's requests have cost in the current allowance month: input and output
tokens together. Cache reads are recorded but do not count against the allowance. Each
request is also recorded against the project whose work it was, so what the factory costs
can be read without a second ledger.
_Avoid_: Spend, consumption, billing, cost

**Refusal**:
A request Foundry does not send — because the user's allowance is spent, or because the
pool would not take it — recorded with the reason so the two are told apart. It costs
nothing.
_Avoid_: Error, failure, rejection, block

**Project**:
A shared body of work, held by the server and worked by anyone signed in to Foundry: the
home of one queue of tickets. Foundry itself is one. A project is not a place on disk, and
it may be worked in from any number of folders at once. Opening a folder joins it to a
project — an existing one or a new one — and that link is what makes the project's tickets
runnable on that machine (ADR 0010).
_Avoid_: Repo, repository, codebase, folder — a project is not one repository, and it
outlives whichever checkout someone happens to have.

**Workspace**:
A folder on someone's own machine that work runs in. One project is worked in from many
workspaces, because each agent working at the same time needs a checkout of its own. A
workspace is where a run happens; it is never what a ticket belongs to.
_Avoid_: Project (the word it replaces), checkout, working directory

**Workbench**:
The part of the window where a chat's own things are looked at: what Kira is holding for it, and
the files in the workspace it works in — open beside the chat rather than instead of it. It
belongs to one chat at a time, and shows nothing that chat is not working in.
_Avoid_: Panel, artifact view, sidebar (that is the rail), workspace (the folder the
workbench is showing)

**Subagent**:
A separate agent Kira delegates a bounded piece of work from one chat. It belongs to that chat: its
activity and conversation are shown in that chat's Workbench, and Kira receives its outcome there.
_Avoid_: Worker (the desktop app that offers itself for ticket work), Run (an agent's attempt at a
ticket)

**Context**:
What Kira is holding for one chat: the goal, the files she touched, the commits, and what the
person asked for and corrected — in the order she was told it — with what she concluded from it
drawn above them. Kept outside the conversation so that reading it is not a turn and costs
nothing. It is not the summary a compaction writes, which says where the work stands; the context
is everything she was given, and what she worked out from it.
_Avoid_: Memory (what the code says for now), history, transcript, prompt

**Conclusion**:
Something Kira worked out from what a chat told her. Drawn once per compaction by a model rather
than observed from the turns, and kept after the turns behind it have gone, which is why it reads
as something she knows rather than something she can check. It carries the last turn it had read
when it was drawn, so how far back it reaches is visible; the same conclusion drawn again is not
drawn twice, so that reach is where it was first worked out.
_Avoid_: Reflection (what the code says), insight, summary (that is the compaction's own)

**Claim**:
A ticket held while someone works it: a worker holds one with a lease and a heartbeat, a
person holds one with neither, and a claimed ticket is ready for nobody else. A claim left
behind shows its age and is taken over by hand rather than released by a clock (ADR 0017).
_Avoid_: Lock, assignment — nobody is assigned work, since only the person a ticket is for
starts a run of it

**Worker**:
A desktop app that has offered itself for work: it is online, it holds the workspaces it can
run in, and it holds a claim for as long as it runs one. It runs what its own person starts
and nothing else — the server says what is ready, and a worker never takes work on its own
(ADR 0012).
_Avoid_: Daemon, runner, host, node, agent (an agent is what a run is of, not what holds it)

**Ticket**:
One unit of work on a project, written so that whoever runs it needs nothing else to hand:
what to build, how it is known to be done, and the other tickets that gate it. A ticket may
have children, and a child blocks its parent, so a ticket is ready to be run only when
nothing under it and nothing gating it is open, nobody holds a claim on it, and it has been
marked ready for an agent.
Its **kind** — prototype, bug, feature, refactor, question, research, spec or map — is set when it is written and
decides what a run of it owes before that run's output counts as a proposal (ADR 0011). Its
**rank** orders it within a band of the queue, which is the only ordering there is: the bands
are derived, never set (ADR 0017).
_Avoid_: Issue — what a ticket is before it has been triaged into this shape

**Spec**:
A ticket of kind spec: an idea worked out with a person — the problem, the solution, and the
stories it must satisfy — whose children are the tickets that build it. Kira writes it from an
interview the person has confirmed, and it stays a draft until the person approves it. It is a
ticket rather than a thing of its own, so it sits in the same queue; its own run comes last,
once every child is done, and checks the children together against what the spec asked for.
A spec has a branch of its own: its children's runs start from it and their accepted work is
merged into it, and a person lands it on the project's main line.
_Avoid_: PRD, epic, plan, parent ticket

**Map**:
A ticket of kind map: an effort too big for one spec, charted as the decisions standing between
here and a destination. Its children are the questions standing in the way, and the destination
is a spec. What
cannot be asked precisely yet is written into the map as not yet specified; what was ruled out
is written as out of scope. The way is clear when no question under it is open.
_Avoid_: Roadmap, initiative, epic

**Outcome**:
What a question or research ticket settled, written on the ticket as it closes: the answer, and
where the longer reasoning lives. A map reads its closed questions' outcomes as the decisions
so far. An outcome that commits the project to something hard to reverse also makes a decision.
_Avoid_: Resolution, answer, result

**Decision**:
Something a project has committed to, with why: the context, what was chosen, what was given up
for it, and what follows. It belongs to the project, not to a repository, and a later decision
may supersede it. Kira proposes one and a person approves it, because it binds work nobody has
written yet.
_Avoid_: ADR, rule, policy, decision ticket (that is a question)

**Glossary**:
The project's own words: each term, what it means, and the words to avoid in its place. It
belongs to the project rather than to a repository. Kira sharpens it as an interview settles
terms, without waiting for approval, and every change keeps who made it and in which chat.
_Avoid_: Context (what Kira holds for one chat), dictionary, vocabulary

**Run**:
One agent's attempt at a ticket, in one workspace, from a claim to an end. It is a chat with a
ticket behind it, so it can be watched and steered while it runs, and only the person the
ticket is for starts and steers it. A ticket has many runs, and a run is never a ticket's
state: it ends as a proposal — a diff, its tests, what a review made of it — which that person
accepts or sends back. Accepting closes the ticket as done; for a ticket in a spec it also
merges the run's work into the spec's branch, and nothing lands on the project's main line
without a person. Its transcript belongs to the ticket, while the driver keeps it in their own
chat list until it ends (ADR 0012).
_Avoid_: Attempt, job, execution, task
