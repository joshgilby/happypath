# Research: Cisco Hash Verification Microservice (Node.js Reimplementation)

## 1. Cisco IOS password hash types 8 & 9 (verification/generation)

**Decision**: Implement type 8/9 support directly on top of Node's built-in `crypto` module
(`crypto.pbkdf2` for type 8, `crypto.scrypt` for type 9). No third-party dependency for the
Cisco-specific format.

**Rationale**: Type 8 is PBKDF2-HMAC-SHA256 (20,000 iterations); type 9 is scrypt
(N=16384, r=1, p=1) — both are standard, well-documented primitives that Node's standard library
already implements natively. What is Cisco-specific is only the `$8$<salt>$<hash>` /
`$9$<salt>$<hash>` string format and salt/digest text encoding, which is a small, self-contained
piece of code (a handful of readable lines), not a cryptographic primitive that needs sourcing
from a library. Searching the npm registry (both fuzzy search and exact-name lookups such as
`cisco-hash`, `cisco-type8`, `cisco-type9`, `ios-type8`, `ios-type9`, `cisco-ios-hash`,
`enable-secret`) turned up no maintained package implementing this format for Node — it is a
niche, network-engineering-specific need that Node's ecosystem hasn't packaged, unlike Python's
`cisco_hashgen` (which the existing service depends on).

**Alternatives considered**:
- Search for a direct npm port of `cisco_hashgen` — none found.
- Hand-roll PBKDF2/scrypt from scratch — rejected; Node's `crypto` module already provides both
  primitives, so there is no reason to reimplement them.

## 2. Encrypted credential store

**Decision**: Use Node's built-in `crypto` module (AES-256-GCM) to encrypt a small JSON file
(service+username → password) at rest, unlocked by a passphrase supplied via an environment
variable — directly mirroring the existing service's `KEYRING_CRYPTFILE_PASSWORD` pattern, but as
a new store per the clarification already recorded in the spec.

**Rationale**: The two most likely "existing module" candidates were evaluated and both are a
poor fit for this service:
- **`keytar`** — bindings to the OS-native credential store (macOS Keychain, Windows Credential
  Vault, Linux Secret Service/libsecret). Its last release was 2022-02-17 (unmaintained), it
  requires native compilation, and on Linux it depends on a desktop secret-service daemon
  (libsecret/gnome-keyring) that is typically absent on the headless Linux servers this service
  targets — the same deployment model the existing Python service uses (passphrase via env var,
  no desktop session).
- **`conf`** — supports an `encryptionKey` option for at-rest encryption, but pulls in nine
  additional dependencies (schema validation, semver, etc.) for a feature this service only needs
  a small slice of: an encrypted key→value lookup.

Given the constitution's emphasis on readability and avoiding unnecessary abstraction, and that
Node's `crypto` module already provides authenticated encryption directly, a small, direct
implementation (encrypt/decrypt two functions plus a plain JSON read/write) is both simpler and
more transparent to a beginner than adopting either dependency.

**Alternatives considered**: `keytar` (rejected — unmaintained, wrong deployment model),
`conf` (rejected — heavier than needed for a simple encrypted key-value file).

## 3. Web framework

**Decision**: Express.

**Rationale**: The existing service exposes a single `GET` endpoint over HTTP. Express is the
most widely known and understood Node.js HTTP framework, which best serves the constitution's
"a beginner programmer should understand the code" principle — a beginner is far more likely to
already be familiar with Express than with a less common alternative.

**Alternatives considered**: Raw Node `http` module (rejected — would require hand-rolling query
string parsing and routing for no real benefit at this scale); Fastify/Koa (rejected — less
universally familiar, and no performance requirement in the spec justifies the trade-off).

## 4. Testing approach

**Decision**: Node's built-in test runner (`node:test`) with the built-in `assert` module.

**Rationale**: Avoids adding a testing-framework dependency (Jest, Mocha, etc.) for a small
service with a handful of acceptance scenarios. `node:test` has been stable since Node 20 and
requires no configuration or build step, keeping the project easy to read and run.

**Alternatives considered**: Jest (rejected — heavier setup/config than needed here).

## 5. Runtime version

**Decision**: Current active Node.js LTS release.

**Rationale**: No functionality in this feature depends on a specific Node version beyond having
`crypto.scrypt`/`crypto.pbkdf2` (stable since early LTS releases) and `node:test` (stable since
Node 20). Targeting current LTS keeps the service on a supported, patched runtime.
