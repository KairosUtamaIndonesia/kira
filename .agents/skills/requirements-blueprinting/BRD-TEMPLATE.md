# BRD Blueprint

Reference for composing a Business Requirement Document. Each section below specifies what content goes there, the required format, and internal Questions to Ask (use during Excavation — do not surface verbatim to the user).

---

## Document Boilerplate

Every BRD starts with these front-matter elements:

- **Document Info table**: Title, Author, Version, Status, Date
- **Revision History table**: Version, Date, Description, Author
- **Approval/Sign-off table**: Approver Name, Role, Date, Signature
- **Table of Contents** (auto-generated from section headings)
- **List of Tables** and **List of Figures** (if applicable)

Use placeholder values for anything not yet known (author name, version, dates).

---

## 1. Business Requirements

### 1.1 Background

**What goes here:** Narrative describing the current state — how the business process works today, pain points, historical context, data sources, and any previous attempts to solve the problem.

**Format:** Prose paragraphs. Can include bullet lists for pain points.

**Questions to Ask (internal — for Excavation):**

- How is the business process performed today, step by step?
- Who is involved and what are their roles?
- What causes the greatest delays or inefficiencies?
- What workarounds do users rely on?
- What are the biggest frustrations with the current system/process?
- Where do errors, rework, or bottlenecks occur?
- Have there been previous initiatives to solve this? Why did they fail?
- What risks (operational, financial, security, compliance) exist in the current state?
- Where does the supporting data reside? How accurate/reliable is it?
- What systems currently support or interact with this process?
- How does the current state impact productivity, cost, or compliance?
- What do stakeholders believe must change immediately?

---

### 1.2 Business Opportunity

**What goes here:** The value proposition — what will be created or improved, why now is the right time, what new capabilities become possible, strategic alignment.

**Format:** 2–4 prose paragraphs.

**Questions to Ask:**

- What specific business value will be created?
- How will it improve productivity, quality, or user experience?
- What measurable benefits are expected (time saved, cost reduced, errors avoided)?
- Why now? What recent events or pressures are driving this?
- What new capabilities or opportunities become possible once this exists?
- How does this connect to corporate strategy, digital transformation, or regulatory requirements?
- Which teams or user groups gain the most?

---

### 1.3 Business Objectives

**What goes here:** Measurable, time-bound objectives the project must achieve. Each objective gets an ID (`BO-1`, `BO-2`, ...), a clear description, and optionally the Planning Language Notation (Scale, Meter, Past, Goal, Stretch).

**Format:** Table or list per objective.

```
BO-1: Reduce cafeteria food wastage cost by 40% within 6 months of release.
  Scale: Cost of food thrown away each week
  Meter: Cafeteria Inventory System logs
  Past:  33% waste rate (baseline)
  Goal:  <20% waste rate
  Stretch: <15% waste rate
```

**Questions to Ask:**

- What specific outcome must this achieve, in measurable terms?
- What baseline metrics exist today?
- What is the realistic goal? What is the stretch target?
- By when must each objective be achieved?
- What financial or operational benefit does achieving it provide?
- Which objectives are mandatory vs. desirable?
- Is the data to measure this already being tracked? Where?

---

### 1.4 Success Metrics

**What goes here:** Adoption, performance, satisfaction, and operational KPIs that define whether the solution is successful. Each gets an ID (`SM-1`, `SM-2`, ...).

**Format:** List with ID, description, and measurement method.

```
SM-1: 75% of eligible employees use the system at least once a week within 6 months.
SM-2: Satisfaction survey score increases by 0.5 within 3 months.
```

**Questions to Ask:**

- What specific indicators will tell us the solution is working?
- Are these leading or lagging indicators?
- How will user adoption be measured?
- What response times or availability levels are required?
- How will user satisfaction be measured (surveys, NPS, support tickets)?
- Does the solution need built-in analytics to measure these?

---

### 1.5 Vision Statement

**What goes here:** A concise elevator pitch using the standard template:

> **For** [target customer] **who** [statement of need], **the** [product name] **is a** [product category] **that** [key benefit]. **Unlike** [current alternative], **our product** [primary differentiation].

**Format:** Single paragraph, 3–5 sentences.

**Questions to Ask:**

- Who is the primary user/customer?
- What is their biggest pain point today?
- How would you describe this product in one sentence?
- What is the current alternative and why is it inadequate?
- What unique benefit does this solution provide?
- Is this internal, customer-facing, mobile, web, or integrated platform?

---

### 1.6 Business Risks

**What goes here:** Risks that could negatively impact the project's value, with probability and impact assessment. Each gets an ID (`RI-1`, `RI-2`, ...).

**Format:** Table or list per risk.

```
RI-1: Poor quality initial data leads to high volume of manual remediation.
  Probability: 0.7   Impact: 6 (scale 1-10)
  Mitigation: Data validation rules and automated cleansing pipeline.

RI-2: Too few users adopt the system, reducing ROI.
  Probability: 0.3   Impact: 9
  Mitigation: Change management program, phased rollout, executive sponsorship.
```

**Risk categories to cover:** Data & system risks, adoption & behavior risks, operational & process risks, technical & integration risks, security & compliance risks.

**Questions to Ask:**

- What risks arise from poor or incomplete data?
- Is there risk that users will resist the new workflow?
- What is the most severe failure that could occur?
- What integrations could fail or become unavailable?
- What are the security, privacy, and compliance risks?

---

### 1.7 Business Assumptions and Dependencies

**What goes here:** Conditions assumed to be true (AS items) and external dependencies (DE items).

**Format:** Two labeled lists.

```
AS-1: Systems with appropriate UIs will be available for processing volume.
AS-2: Staff will be available to deliver within 15 min of requested time.

DE-1: AAGP requires secure read-only access to the mega-query database.
DE-2: Existing APIs will remain stable throughout the project.
```

**Questions to Ask:**

- What technical conditions are we assuming will be available?
- What systems, APIs, or databases must be available for this to work?
- Are we assuming source data is accurate and complete?
- Are there teams whose deliverables must finish before we proceed?
- Are there vendor, contract, or procurement dependencies?
- Do staffing constraints affect the timeline?

---

## 2. Scope and Limitations

### 2.1 Major Features for Release 1.0

**What goes here:** The list of features included in the first release. Each gets an ID (`FE-1`, `FE-2`, ...).

**Format:** Bulleted list with short descriptions.

```
FE-1: Order and pay for meals from the cafeteria menu for pickup or delivery.
FE-2: Order meals from local restaurants for delivery.
FE-3: Create, view, modify, and cancel meal subscriptions.
```

**Questions to Ask:**

- What must the system be able to do on day one?
- Which features are essential for the business to function?
- What actions must users be able to perform?
- What features cannot be removed from this release?
- What features are explicitly NOT included in this release?

---

### 2.2 Scope of Initial and Subsequent Releases

**What goes here:** A release mapping table showing which features go into which release.

**Format:** Table with feature ID, Release 1 scope, and Release 2 (or later) scope.

| Feature Category | Release 1 | Release 2 |
|---|---|---|
| FE-1, Order from cafeteria | Lunch menu only; payroll deduction only | Credit/debit card payments |
| FE-2, Order from restaurants | Not implemented | Delivery to campus only |
| FE-3, Meal subscriptions | Not implemented | If time permits |

**Questions to Ask:**

- What capabilities must be in Release 1 for the solution to function?
- Which features can be deferred?
- Are any features dependent on infrastructure not ready until later?
- What is the minimum viable product (MVP)?
- What risks arise from deferring a feature?

---

### 2.3 Limitations and Exclusions

**What goes here:** Explicit statements of what is not being delivered. Each gets an ID (`LI-1`, `LI-2`, ...).

**Format:** Bulleted list.

```
LI-1: Some food items are not suitable for delivery; delivery menus are a subset.
LI-2: The system is limited to the Clackamas campus.
LI-3: Remediation of revoked access is not automated; system generates a report.
```

**Questions to Ask:**

- What features or workflows are intentionally NOT supported?
- What will remain manual?
- Are there platform, infrastructure, or security constraints?
- What devices/browsers/OS will NOT be supported?
- What might stakeholders incorrectly assume is included?
- Are there regulatory or geographic restrictions?

---

## 3. Business Context

### 3.1 Stakeholder Profiles

**What goes here:** Key stakeholders with their value, attitudes, interests, and constraints.

**Format:** Table.

| Stakeholder | Major Value | Attitudes | Major Interests | Constraints |
|---|---|---|---|---|
| Corporate Management | Improved productivity; cost savings | Strong commitment | Cost savings must exceed costs | None |
| Cafeteria Staff | Efficient staff time; satisfaction | Receptive; union concern | Job preservation | Training needed |
| End Users | Time savings; convenience | Enthusiastic | Simplicity; reliability; choices | Need device/access |

**Questions to Ask:**

- Who are the primary user groups and business units?
- What value does each stakeholder expect?
- What concerns or reservations do they have?
- What constraints (policy, tools, skills) affect their use?
- Which features matter most to each group?

---

### 3.2 Project Priorities

**What goes here:** A constraint/driver/degrees-of-freedom table for features, quality, schedule, cost, and staff.

**Format:** Table.

| Dimension | Constraint | Driver | Degree of Freedom |
|---|---|---|---|
| Features | All Release 1 features must be operational | | |
| Quality | 95% UAT pass; all security tests pass | | |
| Schedule | | | Overrun up to 2 weeks acceptable |
| Cost | | | Overrun up to 15% acceptable |
| Staff | | Team: PM, BA, 3 devs, 1 tester | Additional dev available if needed |

**Questions to Ask:**

- Which dimension is the top priority: features, schedule, budget, or quality?
- What is the least flexible constraint?
- What level of quality/test coverage is required?
- Is phased release acceptable, or must everything go live at once?

---

### 3.3 Use Cases

**What goes here:** Formal use cases for key business workflows. Each gets an ID (`UC-1`, `UC-2`, ...).

**Format:** Table per use case with these fields:

| Field | Content |
|---|---|
| **ID and Name** | UC-1 Descriptive Name |
| **Primary Actor** | Who initiates |
| **Secondary Actors** | Systems or roles involved |
| **Description** | Brief summary |
| **Trigger** | What starts this use case |
| **Preconditions** | What must be true before |
| **Postconditions** | What must be true after |
| **Normal Flow** | Numbered step list |
| **Alternative Flows** | Branch paths |
| **Exceptions** | Error conditions with E-numbers |
| **Priority** | High/Medium/Low |
| **Business Rules** | Rules that govern the flow |

**Questions to Ask:**

- What are the main workflows the user performs?
- What triggers each workflow?
- What must be true before each workflow can start?
- What is the step-by-step "happy path"?
- What can go wrong? How does the system handle it?

---

### 3.4 Deployment Considerations

**What goes here:** Infrastructure changes, app distribution, integration dependencies, user readiness, operational readiness.

**Format:** Sections of prose or bullet lists covering: technical environment, application distribution, integration dependencies, training materials, support readiness, rollback plan.

**Questions to Ask:**

- What infrastructure must be in place before deployment?
- Will users access via web, mobile, or both?
- Are staged rollouts required?
- What training is needed? For whom?
- Is the help desk prepared?
- What is the rollback plan?

---

### 3.5 UI Inspiration / Mockups

**What goes here:** References to UI mockups or screen designs. If none exist, note "To be defined during design phase."

**Format:** Brief prose + image references (mermaid or placeholder).

---

## 4. Appendix

**What goes here:** Planning Language Notation reference (optional, include if the BRD uses formal Scale/Meter/Past/Goal/Stretch notation). This section can be removed from the final document if not needed.

**Planning Language Notation:**

| Component | Meaning | Explanation |
|---|---|---|
| Scale | The unit of measurement | What is being measured (dollars, time, percentage) |
| Meter | The measurement method | How data is collected and verified |
| Past | The baseline | Current documented performance level |
| Goal | The minimum target | Required performance for success |
| Stretch | The aspirational target | Maximum potential success level |
