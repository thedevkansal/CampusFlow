# CampusFlow AI Development Rules

You are working on CampusFlow, a campus ride-sharing platform.

## Tech Stack

* NestJS
* TypeScript
* Prisma ORM
* PostgreSQL
* Redis
* BullMQ
* Socket.IO
* Docker
* JWT Authentication

---

## Architecture Rules

### Controller Layer

* Controllers must remain thin.
* Controllers only:

  * validate request
  * call service
  * return response
* No business logic in controllers.

### Service Layer

* All business logic belongs in services.
* RBAC enforcement belongs in services.
* State-machine validation belongs in services.

### Repository Layer

* All database access goes through repositories.
* No direct Prisma access from controllers.
* Minimize Prisma usage outside repositories.

---

## Data Rules

### PostgreSQL

* PostgreSQL is always the source of truth.

### Redis

* Redis is cache and coordination only.
* Missing Redis data must never corrupt business logic.
* Use PostgreSQL fallback whenever architecture documents specify one.

---

## Development Workflow

For every task:

### Step 1

Read all relevant files and architecture documents.

### Step 2

Identify:

* requirements
* dependencies
* risks
* ambiguities
* ownership rules
* state-machine impacts
* Redis impacts
* BullMQ impacts

### Step 3

Produce an implementation plan.

The implementation plan must include:

* files to create
* files to modify
* endpoint changes
* schema impacts
* Redis impacts
* queue impacts
* risks
* verification strategy

### Step 4

STOP.

Do not generate code.

Wait for explicit approval.

Only after approval may implementation begin.

---

## Important Restrictions

Never:

* generate code immediately
* modify files immediately
* push to GitHub
* create commits
* create tags
* merge branches
* delete files
* refactor unrelated code

without explicit approval.

---

## Existing Project Status

Completed:

* Infrastructure
* Authentication
* Users Module
* Drivers Module
* Ride Lifecycle (Phase 3A)
* Ride Assignment & Driver Flow (Phase 3B)

Current branch:
feature/rides-matching

Current focus:
Phase 3C

Before implementing any feature, verify compatibility with all existing phases.

---

## Verification Requirements

Before approval:

* verify assumptions against existing code
* verify assumptions against architecture docs
* verify RBAC requirements
* verify state transitions
* verify Redis schema
* verify BullMQ interactions

If any ambiguity exists:

Do not guess.

List the ambiguity explicitly and request clarification.

---

## Output Format

Always respond in this order:

1. Understanding
2. Verification Findings
3. Risks / Ambiguities
4. Implementation Plan
5. Verification Plan

Then stop and wait for approval.
