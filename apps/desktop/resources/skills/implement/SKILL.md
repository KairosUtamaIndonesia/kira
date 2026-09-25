---
name: implement
description: Implement one Kira ticket or approved spec through its acceptance criteria.
disable-model-invocation: true
---

Implement the work described by the current Kira ticket or approved spec.

Use test-first slices at the highest existing seam. Run typechecking regularly, run focused tests while changing a slice, and run the full relevant suite before the run reports completion. Keep the ticket's acceptance criteria visible and use the server's refusal behavior for invalid transitions.

A run is complete only when the behavior works, the checks pass, the ticket has a concise run summary and no unrecorded tracker state was changed. Use Kira's run and verdict actions to report the result; do not close or mark work ready by editing storage directly.
