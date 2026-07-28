# Quickstart: Cisco Hash Verification Microservice (Node.js Reimplementation)

## Prerequisites

- Current active Node.js LTS installed.
- A passphrase for the encrypted credential store, exported as an environment variable
  (analogous to the existing service's `KEYRING_CRYPTFILE_PASSWORD`).

## Setup

```sh
cd source/cisco-hash-microservice
npm install
export CREDENTIAL_STORE_PASSWORD=foobar
```

## Seed a test credential

For local validation only (credential management in production is handled by the separate,
existing method described in the spec — this mirrors the existing service's `initdb.py` dev
fixture, it is not a feature of the running API):

```sh
node seed.js router localuser weakpassword
```

## Run the service

```sh
node index.js
```

## Validate against the contract

See [contracts/verify-endpoint.md](contracts/verify-endpoint.md) for the full request/response
shape. Using the same example requests as the existing service (see
`source/cisco-hash-microservice/tests.sh` in the original implementation):

```sh
curl 'http://localhost:8000/?username=localuser&service=router&password_hash=$9$UK9FYKZUD.n94E$qcLQeaiNaUjVj181Q8Hh2cUya7qdMV4q.qszxl3H0Ha' # expect status "fail"
curl 'http://localhost:8000/?username=localuser&service=router&password_hash=$8$LkGlosq.R44sx.$VLpv7K56GEx6jhU4aMKgsGXvMo1n1EE/fElkbpJXQfY' # expect status "pass"
```

## Run automated tests

```sh
node --test
```

Expected: verification against a correct hash returns `pass` with the same hash echoed back;
verification against an incorrect hash returns `fail` with a freshly generated type 8 hash of the
real password (see [data-model.md](data-model.md)).
