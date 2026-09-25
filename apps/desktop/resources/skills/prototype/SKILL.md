---
name: prototype
description: Build a throwaway prototype to answer one Kira design question.
---

A prototype is throwaway code that answers one question. State that question before writing code and choose the smallest artifact that lets a person judge it.

- For logic or state, make one self-contained HTML demo with pure state transitions, free-play actions and guided edge-case walkthroughs.
- For UI, use the nearest existing surface and show a few structurally different variants behind a clearly temporary switcher.

Keep state in memory, avoid production integrations and show the full relevant state after each action. Use domain language rather than implementation jargon. Do not polish beyond what is needed to make the question visible.

When the person has chosen an answer, propose it with `propose_outcome` when the prototype answers a question ticket, or with `propose_decision` otherwise, and wait for the approval card. Lift only the validated logic or design into production; keep the throwaway artifact attached to the prototype run rather than shipping it as application behavior.
