# Implementation Plan: Cisco Hash Verification Microservice (Node.js Reimplementation)

**Branch**: `001-cisco-hash-nodejs` | **Date**: 2026-07-28 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-cisco-hash-nodejs/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Reimplement `source/cisco-hash-microservice` (currently a FastAPI/Python service) as a Node.js
service with the same behavior: given a service, username, and submitted password hash, look up
the stored password and return `pass` (echoing the hash) or `fail` (with a freshly generated type
8 hash of the real password). Per research, no existing npm package covers Cisco's type 8/9 hash
format or fits this service's encrypted-file credential-store model, so both are built directly on
Node's built-in `crypto` module rather than on a third-party dependency — satisfying the spec's
"use existing modules where available" instruction by using what Node's standard library already
provides for the underlying cryptography, and keeping the small remaining Cisco-specific logic
simple and readable per the project constitution.

## Technical Context

**Language/Version**: JavaScript (Node.js, current active LTS) — no TypeScript/build step, for
readability per the constitution.

**Primary Dependencies**: Express (HTTP layer). Node's built-in `crypto` module for both password
hash verification/generation (PBKDF2 for type 8, scrypt for type 9) and at-rest encryption of the
credential store (AES-256-GCM) — see [research.md](research.md).

**Storage**: A single encrypted JSON file (service+username → password), encrypted/decrypted with
a passphrase from an environment variable — a new store per the spec's clarification, not the
existing Python service's `keyrings.cryptfile` file.

**Testing**: Node's built-in test runner (`node:test` + `assert`).

**Target Platform**: Linux server (matches the existing service's deployment model).

**Project Type**: Single small web-service (one HTTP endpoint).

**Performance Goals**: Respond within 1 second per request (SC-001/SC-002) — a low bar; PBKDF2/
scrypt and file decryption at this scale run in milliseconds.

**Constraints**: No client authentication/authorization on the endpoint (matches existing
service); no logging, input validation, or error handling beyond what's needed to run, per the
constitution's Happy-Path-Only principle and the spec's edge-case defaults.

**Scale/Scope**: Single internal endpoint, low request volume, one small credential file — not a
multi-tenant or high-concurrency system.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Result |
|---|---|---|
| I. Readability First | Plain JavaScript, no build step, Express (widely known), no abstraction layers | PASS |
| II. Happy-Path-Only Implementation | No auth middleware, no speculative validation/error handling/logging beyond what the spec's edge cases call for | PASS |
| III. No Premature Abstraction | Single small module per concern (HTTP handler, hash format, credential store); no repository/DI patterns for a one-file credential store | PASS |
| Code Style Constraints | No try/except-equivalent, validation, or logging added speculatively | PASS |

No violations — Complexity Tracking table is not needed.

## Project Structure

### Documentation (this feature)

```text
specs/001-cisco-hash-nodejs/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
source/cisco-hash-microservice/
├── package.json
├── index.js              # Express app + the GET / handler
├── ciscoHash.js           # type 8 / type 9 verify + generate (built on node:crypto)
├── credentialStore.js     # encrypted JSON file read/lookup (built on node:crypto)
├── seed.js                # dev/test-only fixture, mirrors the old initdb.py
├── readme.md              # updated to describe the Node.js version
└── test/
    ├── index.test.js            # node:test acceptance scenarios from the spec
    └── credentialStore.test.js  # node:test coverage for SC-004 (wrong/missing passphrase)
```

The existing Python files (`main.py`, `initdb.py`, `pyproject.toml`, `env.sh`) are superseded by
the files above, since this is a reimplementation of the same service in the same directory, not
a parallel implementation.

**Structure Decision**: Single small project, in place at `source/cisco-hash-microservice/`
(the directory named in the feature request), with one file per concern (HTTP layer, hash
format, credential store) — no `src/`, `models/`, `services/` layering, since the whole service
is a few small files and that structure would be premature abstraction for this scope.

## Post-Design Constitution Check

*Re-checked after Phase 1 design (data-model.md, contracts/, quickstart.md).*

The finalized design (Express + two small `node:crypto`-based modules + one encrypted JSON file,
no auth layer, no validation/logging beyond the happy path) is unchanged in kind from the initial
Constitution Check above — still four small, direct, readable files with no added abstraction.
All gates remain PASS; no complexity to justify.
