# cisco-hash-microservice

Microservice to verify password hashes from Cisco devices, implemented in Node.js. The service
implements an API that:

1. receives a service, username, and password hash as input,
2. fetches the corresponding password from an encrypted credential store,
3. verifies whether the password and hash match,
4. on success, returns the original hash; on failure, returns a new hash of the password.

## Contract

`GET /` — query parameters `username`, `service`, `password_hash`. Responds with JSON:

- Match: `{ "status": "pass", "hash": "<the submitted password_hash, unchanged>" }`
- Mismatch: `{ "status": "fail", "hash": "<a freshly generated type 8 hash of the real password>" }`

Supports Cisco IOS password hash types 8 (PBKDF2-SHA256) and 9 (scrypt).

## Setup

```sh
npm install
export CREDENTIAL_STORE_PASSWORD=foobar
```

## Seed a credential (dev/test fixture)

```sh
node seed.js router localuser weakpassword
```

## Run

```sh
node index.js
```

Listens on port 8000 by default; override with the `HASH_SERVICE_PORT` environment variable.

## Test

```sh
node --test
```

See [../../specs/001-cisco-hash-nodejs/quickstart.md](../../specs/001-cisco-hash-nodejs/quickstart.md)
for a full walkthrough, and [tests.sh](tests.sh) for example requests.
