---
name: diagnosing-bugs
description: Diagnose a stubborn Kira failure with a tight reproducer and regression test.
---

Use this for a bug that resists a first glance, flakes, regressed or has unclear ownership. Refuse to theorize until a command or focused test goes red on the reported behavior.

## Loop

1. Capture the smallest red reproducer and run it repeatedly enough to trust it.
2. Minimize the scenario one variable at a time.
3. List falsifiable hypotheses and show the ranking to the person.
4. Probe one hypothesis at a time, keeping logs tagged and temporary.
5. Lock the minimized repro into a regression test at the highest useful seam.
6. Make the smallest fix, then rerun the original reproducer and the relevant suite.

If the environment needed to reproduce is unavailable, state exactly what artifact or access is needed. Do not invent a theory in its place. Remove tagged instrumentation and temporary fixtures before the run finishes, and put the proven cause and checks in the Kira run summary.
