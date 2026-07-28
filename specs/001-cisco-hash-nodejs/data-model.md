# Data Model: Cisco Hash Verification Microservice (Node.js Reimplementation)

## Stored Credential

The password on record for one service/username pair. Read-only from this service's point of
view (populated by the separate password-management method — see spec Assumptions).

| Field    | Type   | Notes                                             |
|----------|--------|----------------------------------------------------|
| service  | string | Part of the lookup key, e.g. `router`             |
| username | string | Part of the lookup key, e.g. `localuser`           |
| password | string | Plaintext password, encrypted at rest in the store |

Identity/uniqueness: the `(service, username)` pair is the lookup key; one password per pair.

## Verification Request

The inbound query this service accepts.

| Field         | Type   | Notes                                    |
|---------------|--------|-------------------------------------------|
| service       | string | Selects which Stored Credential to check |
| username      | string | Selects which Stored Credential to check |
| password_hash | string | A Cisco type 8 or type 9 hash string      |

## Verification Result

The response this service returns.

| Field  | Type   | Notes                                                                 |
|--------|--------|------------------------------------------------------------------------|
| status | string | `"pass"` or `"fail"`                                                   |
| hash   | string | On pass: the submitted hash, echoed back. On fail: a freshly generated type 8 hash of the actual stored password |

No state transitions apply — each request is evaluated independently against the current Stored
Credential.
