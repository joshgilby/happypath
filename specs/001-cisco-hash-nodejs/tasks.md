---

description: "Task list template for feature implementation"
---

# Tasks: Cisco Hash Verification Microservice (Node.js Reimplementation)

**Input**: Design documents from `/specs/001-cisco-hash-nodejs/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/verify-endpoint.md](contracts/verify-endpoint.md), [quickstart.md](quickstart.md)

**Tests**: Included — the plan's Technical Context specifies `node:test` and quickstart.md documents running `node --test`, so test tasks are part of each story's implementation, not optional add-ons.

**Organization**: Tasks are grouped by user story (from spec.md) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2)
- Include exact file paths in descriptions

## Path Conventions

All paths are relative to `source/cisco-hash-microservice/` (the existing service's directory,
reused per plan.md's Structure Decision — the Node files supersede the existing Python ones in
place).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization

- [X] T001 Initialize the Node.js project: `package.json` in `source/cisco-hash-microservice/package.json` with `express` as a dependency and a `test` script running `node --test`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core building blocks both user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 [P] Implement the encrypted credential store (AES-256-GCM encrypt/decrypt of a JSON file, keyed by an env-provided passphrase, with a `getPassword(service, username)` lookup per [data-model.md](data-model.md)'s Stored Credential) in `source/cisco-hash-microservice/credentialStore.js` The password for the credential store is passed via the CREDENTIAL_STORE_PASSWORD environment variable.
- [X] T003 [P] Write a `node:test` case asserting the credential store fails to decrypt (throws/rejects rather than returning data) when `CREDENTIAL_STORE_PASSWORD` is wrong or missing, per SC-004, in `source/cisco-hash-microservice/test/credentialStore.test.js` (depends on T002)
- [X] T004 [P] Implement Cisco type 8/9 hash support — `verifyPassword(password, hash)` (detects type 8 vs. 9 from the `$8$`/`$9$` prefix) and `generateType8Hash(password)`, built on `node:crypto`'s `pbkdf2`/`scrypt` per [research.md](research.md) — in `source/cisco-hash-microservice/ciscoHash.js`
- [X] T005 Implement the dev/test seed script — writes one `(service, username, password)` credential into the encrypted store, mirroring the old `initdb.py` fixture — in `source/cisco-hash-microservice/seed.js` (depends on T002)

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 - Verify a device password hash (Priority: P1) 🎯 MVP

**Goal**: Accept a service/username/password_hash request, look up the stored password, and
return `pass` (echoing the hash) or `fail` (with a freshly generated type 8 hash of the real
password), per [contracts/verify-endpoint.md](contracts/verify-endpoint.md).

**Independent Test**: Seed a credential, then request verification with (a) a hash matching that
credential and (b) a hash that doesn't, and confirm the two different outcomes.

### Tests for User Story 1

- [X] T006 [P] [US1] Write `node:test` cases for `GET /` covering the pass case (matching hash) and the fail case (non-matching hash, response includes a regenerated type 8 hash) in `source/cisco-hash-microservice/test/index.test.js`. Response times should be under 1 second. For the fail case, per FR-009, also assert the regenerated hash is valid by running it through `ciscoHash.verifyPassword` against the real stored password.

### Implementation for User Story 1

- [X] T007 [US1] Implement the Express app and `GET /` handler — reads `username`, `service`, `password_hash` query params, looks up the credential via `credentialStore.js`, verifies via `ciscoHash.js`, and returns the JSON result per FR-001–FR-006 — in `source/cisco-hash-microservice/index.js` (depends on T002, T004). The service listens on port 8000 by default. The port can be specified with the 
HASH_SERVICE_PORT environment variable.
- [X] T008 [US1] Rewrite `source/cisco-hash-microservice/readme.md` to describe the Node.js service: what it does, the `GET /` contract, and how to run it (link to [quickstart.md](quickstart.md))

**Checkpoint**: User Story 1 is fully functional and independently testable.

---

## Phase 4: User Story 2 - Behave as a drop-in replacement (Priority: P2)

**Goal**: Confirm the reimplemented service produces the same results as the existing service for
its documented example requests, per FR-009/SC-003.

**Independent Test**: Run the existing service's two documented example requests against the new
service and confirm the results match what's documented.

### Tests for User Story 2

- [X] T009 [P] [US2] Write a `node:test` case replaying the two example requests from the existing service's `tests.sh` comments (one expected to fail, one expected to pass) and asserting the Node service's `status` matches in `source/cisco-hash-microservice/test/index.test.js` (depends on T005 for the seeded credential the examples rely on)

### Implementation for User Story 2

- [X] T010 [US2] Update `source/cisco-hash-microservice/tests.sh` so its example `curl` commands and comments describe running them against the Node service (same host/port/contract, per [contracts/verify-endpoint.md](contracts/verify-endpoint.md)) (depends on T007)

**Checkpoint**: Both user stories are independently functional; the new service is confirmed at
parity with the original for its documented examples.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Finish the reimplementation

- [X] T011 Remove the now-superseded Python implementation (`main.py`, `initdb.py`, `pyproject.toml`, `env.sh`) from `source/cisco-hash-microservice/`, since the Node.js files replace them per plan.md's Structure Decision
- [X] T012 Run through [quickstart.md](quickstart.md) end-to-end (install, seed, run, curl, `node --test`) to confirm the reimplementation works as documented

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS both user stories
- **User Story 1 (Phase 3)**: Depends on Foundational (T002, T004)
- **User Story 2 (Phase 4)**: Depends on Foundational (T005) and on User Story 1's endpoint (T007) existing to test against
- **Polish (Phase 5)**: Depends on both user stories being complete

### Within Each User Story

- Tests written before/alongside implementation, expected to fail until the implementation task lands
- Foundational modules (credential store, hash support) before the endpoint that wires them together
- Story complete before moving to the next priority

### Parallel Opportunities

- T002 and T004 (Foundational) touch different files and can run in parallel; T003 touches its own test file and can be written in parallel too, though it only becomes meaningful once T002 lands
- T006 (US1 test) and T009 (US2 test) touch the same test file, so they should not run concurrently with each other, but each can be written in parallel with unrelated work in the other phase

---

## Parallel Example: Foundational Phase

```bash
Task: "Implement the encrypted credential store in source/cisco-hash-microservice/credentialStore.js"
Task: "Write a node:test case asserting the credential store fails to decrypt with a wrong/missing passphrase in source/cisco-hash-microservice/test/credentialStore.test.js"
Task: "Implement Cisco type 8/9 hash support in source/cisco-hash-microservice/ciscoHash.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (credential store + hash support — blocks everything)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Seed a credential and confirm pass/fail behavior via `curl`, per quickstart.md
5. This is a working, deployable replacement for the verification behavior alone

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. User Story 1 → verification works → validate independently (MVP)
3. User Story 2 → parity with the existing service confirmed → validate independently
4. Polish → remove old Python files, run full quickstart validation

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- This is a small, single-directory service — per the constitution's No Premature Abstraction
  principle, there is deliberately no `src/`/`models/`/`services/` layering; each file is one
  concern (store, hash format, HTTP handler)
- No input validation, auth, or logging tasks are included, per the constitution's
  Happy-Path-Only principle and the spec's Assumptions (no client auth; minimal error handling
  matching the existing service)
- Commit after each task or logical group
- Stop at the Phase 3 checkpoint to validate User Story 1 independently before continuing
