---
name: requirements-blueprinting
description: >-
  Use when the user needs a BRD, FSD, or TSD produced for a project.
  Also when the user mentions Business Requirement Document, Functional
  Specification Document, Technical Design Document, requirements
  documentation, functional specs, technical design, or project
  specification documents that need a structured blueprint.
---

# Requirements Blueprinting

A skill for producing predictable, structured requirements documents — **BRD** (Business Requirement Document), **FSD** (Functional Specification Document), and **TSD** (Technical Design Document) — from project context. Three **branches**, one document per invocation. Each branch follows a four-phase process: **Excavation → Blueprint → Composition → Craftsmanship**.

## Leading Words

- **Blueprint** — the document template: the expected output structure with sections, tables, and ID registers. Each branch loads its own blueprint from a disclosed reference file.
- **Excavation** — the upfront work of gathering project information: scanning the codebase/repo for facts, processing provided inputs, then interviewing the user on gaps. The interview follows a disciplined pattern: form a hypothesis with a confidence number, ask one question at a time with your guess attached, wait for the answer before proceeding, and when you can predict the user's next three answers, restate intent and confirm.
- **Composition** — generating the document: weaving excavation notes into the blueprint, section by section, assigning traceability IDs as you go.
- **Craftsmanship** — the quality pass: traceability scan, coverage check, formatting pass, language consistency.

## Branching

One document per invocation. The user specifies which branch. Each loads its blueprint from a disclosed reference file:

| Branch | Blueprint | Purpose |
|--------|-----------|---------|
| BRD | [BRD-TEMPLATE.md](BRD-TEMPLATE.md) | Captures business context, objectives, scope, risks, success metrics, use cases — the *what* and *why*. |
| FSD | [FSD-TEMPLATE.md](FSD-TEMPLATE.md) | Describes functional behavior, user roles, business process flows, screen designs, business rules, non-functional requirements — the *how* from the user's view. |
| TSD | [TSD-TEMPLATE.md](TSD-TEMPLATE.md) | Specifies system architecture, data model, API contracts, security, deployment, infrastructure — the *how* from the engineer's view. |

Shared definitions (ID conventions, terms) are in [GLOSSARY.md](GLOSSARY.md).

**Parameters the agent resolves (from user input or excavation):**

- `branch` — BRD, FSD, or TSD
- `language` — output language (default `en`; any language accepted)
- `project` — free-text brief, repo path, or files to scan (optional; the agent excavates what it can)

## Process

### Phase 1: Excavation

**Goal:** Gather enough project context to fill every blueprint section.

**Completion criterion:** Every section of the loaded blueprint that requires external input has been addressed — each field is either filled from evidence or explicitly marked as an assumption/TBD. No requirement is silently skipped.

**Method:**

1. **Scan available inputs.** Read any files, repos, or briefs the user provided. Extract: project name/domain/organization, business context (current process, pain points, data sources), features/scope/limitations, tech stack/architecture/integrations, stakeholders/user roles.

2. **Identify gaps.** Compare what you extracted against every section header in the blueprint. For each section, determine whether you have enough to write it or need clarification.

3. **Interview on gaps.** For each gap, run this protocol:
   - Form a hypothesis about what the user needs, with a confidence number (e.g., "30% — we don't know who the users are")
   - Ask **one question at a time** with your guess attached so the user can react to a wrong guess faster than they generate an answer from scratch
   - Wait for the user to answer before asking the next question
   - When you can predict the user's next three answers without asking, restate your understanding and get an explicit "yes"

   The **Questions to Ask** listed per section in the blueprint are your interview guide. Internalize what each section needs to establish and ask natural questions that fill those needs. Do not read them verbatim to the user.

4. **Document findings.** Write structured excavation notes keyed to blueprint section IDs. These feed into Composition.

### Phase 2: Blueprint

**Goal:** Load the document-specific template and prepare the output skeleton.

**Completion criterion:** Document skeleton built with all sections. Traceability ID counters initialized.

**Method:**

1. Read the relevant `*-TEMPLATE.md` for the selected branch.
2. Construct the output document with:
   - Document header (title, version, author — use placeholders for unknowns)
   - Revision history table
   - Approval/sign-off page (placeholder signatories)
   - Table of contents
   - All sections from the blueprint in order
3. Initialize traceability ID counters per [GLOSSARY.md](GLOSSARY.md) conventions. BRD starts each counter at 1. FSD/TSD carry forward IDs defined in the BRD.

### Phase 3: Composition

**Goal:** Produce the document by filling each blueprint section with excavation notes.

**Completion criterion:** Every section has substantive content. No empty sections. Mermaid diagrams embedded where applicable.

**Method:**

1. Work through blueprint sections in document order.
2. For each section:
   - If excavation notes exist, compose the section from them.
   - If the blueprint specifies a table (objectives, features, risks, use cases), render it in proper markdown.
   - Assign traceability IDs to each new item as you create it. Log assigned IDs so later references are consistent.
   - Where the blueprint calls for a diagram (process flow, architecture, data model), emit a Mermaid code block.
3. When every section is filled, return the complete document.

**Mermaid diagram conventions:**

| Use case | Mermaid type | Notes |
|----------|-------------|-------|
| Process flows | `flowchart TD` or `flowchart LR` | Use `subgraph` for swimlanes |
| System architecture | `graph TB` | Container-level; label relationships |
| Data model / ERD | `erDiagram` | Entities, attributes, relationships |
| API / interaction sequences | `sequenceDiagram` | Participant calls with request/response |
| Use case context | markdown table | No Mermaid standard; use table |

### Phase 4: Craftsmanship

**Goal:** Verify and polish.

**Completion criterion:** All four checks pass.

**Checks:**

1. **Traceability scan** — every ID referenced in the document is defined somewhere in it. No dangling references (see [GLOSSARY.md](GLOSSARY.md) for the ID prefix convention).
2. **Coverage check** — every section from the blueprint has content; no section was left empty or contains only placeholder text.
3. **Formatting pass** — tables properly rendered, Mermaid blocks syntactically valid, ID prefixes consistent, section numbering correct.
4. **Language check** — the document uses the specified language consistently throughout. No stray-language paragraphs.
## Invocation

This skill is **model-invoked** — the agent fires autonomously when the user mentions BRD, FSD, TSD, or requirements documentation. The user can also type `requirements-blueprinting` explicitly.
