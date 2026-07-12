# Glossary — Requirements Blueprinting

Domain model and conventions for the `requirements-blueprinting` skill. Terms that appear in **bold** are defined in this glossary.

---

## ID Convention

The canonical list of traceability ID prefixes. **Single source of truth** — every other file in this skill points here.

```text
Prefix  Stands For              Used In
------  ----------              -------
BO-#    Business Objective      BRD
SM-#    Success Metric          BRD
RI-#    Risk                    BRD
AS-#    Assumption              BRD, FSD, TSD
DE-#    Dependency              BRD, FSD, TSD
FE-#    Feature                 BRD, FSD, TSD
LI-#    Limitation / Exclusion  BRD, FSD, TSD
UC-#    Use Case                BRD
```

**Rules:**

- IDs are scoped per document set. A BRD **defines** them (BO-1, FE-3, etc.). The FSD and TSD **carry forward** the same IDs — when an FSD references `BO-1` or `FE-3`, the reader looks up the BRD that governs the project.
- Within a document, IDs are unique and sequential per prefix (BO-1, BO-2, …; FE-1, FE-2, …).
- An FSD or TSD may introduce new FE- or LI- items if the design reveals scope not captured in the BRD. New items continue the existing sequence (e.g., FE-8 follows BRD's FE-7).

---

## Traceability

The property that every ID referenced in a document has a definition somewhere in the document set. A **traceability scan** (Craftsmanship Phase 1) confirms this: no dangling references, every `FE-3` used in a use case has a corresponding definition in the Features section.

---

## Document Header

Every document produced by this skill includes:

| Element | Content |
|---|---|
| Title | Document name + project name |
| Author | Placeholder or known author |
| Version | `x.y.z` (start at `1.0.0`) |
| Status | Draft / Review / Approved |
| Date | Generation date |

## Revision History

| Version | Date | Description | Author |

## Approval / Sign-off

| Approver | Role | Date | Signature |
