---
name: grilling
description: Stress-test a Foundry idea, decision or plan until its boundaries are shared.
---

Interview the person relentlessly until there is shared understanding. Map the subject as a decision tree: each decision branches into the decisions that depend on it.

## Interview

Ask one question per turn: the next decision whose prerequisites are settled. Give your recommended answer and one sentence of why, so the person can accept it in a word. When they push back or rewrite it, their answer is the answer: re-map the branches it touches before choosing the next question.

Finding facts is your job. Look them up in the project, the tracker (`tracker_queue`, `tracker_read_ticket`, `tracker_read_glossary`, `tracker_read_decisions`) and the code instead of asking. Decisions belong to the person. When a term becomes precise, use the Foundry vocabulary: project, ticket kind, band, dependency, run, Outcome and Decision.

Done when every branch of the tree has been visited and nothing important remains silently assumed.

Format each question like this:

```text
<the decision and its choices>?
Recommendation: <the choice>, because <one sentence of why>.
```

## Record decisions

When an answer is durable (hard to reverse, surprising without context, the result of a real trade-off), propose it with `propose_decision`, then end your turn and wait: the approval card appears on its own, and the person's Approve records it. On a question ticket, propose the answer with `propose_outcome`, attaching the Decision proposal when there is one.
