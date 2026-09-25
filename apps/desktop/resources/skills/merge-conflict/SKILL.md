---
name: merge-conflict
description: Resolve an active project merge conflict by preserving the intent of both changes.
disable-model-invocation: true
---

Use this only when the project checkout has an active merge conflict.

1. Inspect the current operation, the ticket or run that asked for it, and both sides of every conflicted file.
2. Find the primary source for each intent: the relevant ticket, Decision, run summary and nearby tests.
3. Resolve each hunk by preserving both intents where possible. When they are incompatible, choose the behavior that satisfies the active ticket and record the trade-off in the run.
4. Search for remaining conflict markers, then run formatting, typechecking and focused tests before the full relevant suite.
5. Stage the resolved files and finish the project operation through its normal Kira checkout flow.

Never hide a conflict by discarding one side, and never report success while conflict markers or failing checks remain.
