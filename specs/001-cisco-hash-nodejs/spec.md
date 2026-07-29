# Feature Specification: Cisco Hash Verification Microservice (Node.js Reimplementation)

**Feature Branch**: `001-cisco-hash-nodejs`

**Created**: 2026-07-28

**Status**: Draft

**Input**: User description: "Reimplement the microservice in source/cisco-hash-microservice in node.js. Use existing modules for hash verification and password storage, if available."

## Clarifications

### Session 2026-07-28

- Q: Should this service read from the same encrypted store file the existing Python service uses, or a new store populated separately? → A: New equivalent store — the separate password-management method populates a new, Node-compatible encrypted credential store going forward; the existing Python `keyrings.cryptfile` file is not read directly, and today's credentials would need to be re-added.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Verify a device password hash (Priority: P1)

A calling system (such as network automation tooling) needs to check whether a password hash
presented for a given service and username matches the password on record, and get back either
confirmation or a fresh hash of the real password.

**Why this priority**: This is the entire purpose of the microservice — without verification,
there is no product.

**Independent Test**: Can be fully tested by requesting verification for a known service/username
pair with (a) a hash that matches the stored password and (b) a hash that does not, and confirming
the two different outcomes.

**Acceptance Scenarios**:

1. **Given** a stored password exists for a service and username, **When** a matching password
   hash is submitted for that pair, **Then** the system responds with a "pass" result and the
   submitted hash.
2. **Given** a stored password exists for a service and username, **When** a non-matching password
   hash is submitted for that pair, **Then** the system responds with a "fail" result and a freshly
   generated hash of the actual stored password.

---

### User Story 2 - Behave as a drop-in replacement (Priority: P2)

A calling system switching from the existing service to the reimplemented one needs the new service to
produce the same results for the same inputs, so existing callers do not need to change.

**Why this priority**: Ensures the reimplementation is safe to adopt without disrupting whatever
already calls the existing service.

**Independent Test**: Can be fully tested by running the existing service's documented example
requests against the reimplemented service and comparing results.

**Acceptance Scenarios**:

1. **Given** the example requests documented for the current service, **When** the same requests
   are issued to the reimplemented service, **Then** the results (pass/fail status and hash) match
   the current service's behavior.

---

### Edge Cases

- What happens when there is no stored password for the requested service/username pair?
- What happens when the submitted password hash is not in a recognized/supported format?
- What happens when the request is missing the service, username, or password hash?
- How does the system respond if the credential store itself cannot be unlocked (e.g., wrong store
  passphrase)?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST accept a verification request containing a service identifier, a
  username, and a password hash.
- **FR-002**: System MUST look up the stored password for the given service and username from a
  new, dedicated credential store (populated and managed by a separate, existing means outside this
  feature — not the legacy Python service's store).
- **FR-003**: System MUST determine whether the submitted password hash matches the stored
  password.
- **FR-004**: When the hash matches, system MUST return a "pass" result along with the submitted
  hash.
- **FR-005**: When the hash does not match, system MUST return a "fail" result along with a newly
  generated hash of the actual stored password.
- **FR-006**: System MUST support the same Cisco device password hash formats that the existing
  service supports (type 8 and type 9).
- **FR-007**: System MUST keep stored passwords encrypted at rest, at a protection level at least
  equivalent to the existing service.
- **FR-008**: System MUST reuse existing, established libraries for password-hash
  verification/generation and for encrypted password storage rather than custom-built
  cryptography, wherever a suitable library exists for the new implementation. Since there is no
  equivalent to support either hash verification or password storage, the capabilities will be built 
  directly on Node's built-in "node:crypto" module.
- **FR-009**: System MUST produce the equivalent observable results (status and hash) as the existing
  service for equivalent inputs. Status MUST match exactly. Hash MUST be valid for the actual stored 
  password using the same verification logic as the pass case.

### Key Entities

- **Stored Credential**: A password associated with a specific service and username; the source
  of truth used for verification. Populated and maintained by a separate, existing mechanism —
  this feature only reads from it.
- **Verification Request**: An inbound check consisting of a service, a username, and a submitted
  password hash.
- **Verification Result**: The outcome of a verification request — a status (pass/fail) and a
  hash (the submitted hash when passing, or a freshly generated hash of the real password when
  failing).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A verification request with a correct password hash returns a "pass" result in
  under 1 second.
- **SC-002**: A verification request with an incorrect password hash returns a "fail" result and a
  usable replacement hash in under 1 second.
- **SC-003**: 100% of the existing service's documented example requests produce equivalent
  results on the reimplemented service.
- **SC-004**: Stored passwords remain inaccessible to anyone without the credential store's
  protection secret, matching current protection guarantees.

## Assumptions

- The request/response contract (inputs: service, username, password hash; outputs: status and
  hash) stays the same as the existing service, since the goal is a reimplementation of the same
  microservice rather than a new API design.
- Node.js is the required runtime for this reimplementation, per the explicit request driving this
  feature — this is a fixed constraint, not an implementation detail chosen during design.
- This service only fetches passwords; storing/managing passwords in the credential store is handled
  by a separate, existing method and is out of scope for this feature.
- The reimplementation reads from a new, equivalently-protected encrypted credential store
  (looked up by service and username), populated by the separate password-management method; it
  does not read the existing Python service's `keyrings.cryptfile`-format store directly, and
  migrating today's stored credentials into the new store is a separate, later concern.
- The API itself requires no client authentication/authorization, matching the existing service,
  since this is an internal tool reachable only by trusted automation systems.
- The password hash formats to support are the same Cisco IOS types (8 and 9) the current service
  already handles.
- This is an internal, operator-facing tool used by network automation tooling rather than an
  end-user product, so success criteria focus on correctness and response time.
- Suitable existing Node.js packages are unavailable for Cisco-style password hash
  verification/generation and for encrypted local credential storage; 
  these will be implemented directly rather than left unimplemented.
