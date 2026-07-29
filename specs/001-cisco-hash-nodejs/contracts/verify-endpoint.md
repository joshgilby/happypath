# Contract: Verification Endpoint

Mirrors the existing service's contract exactly (see spec Assumptions — the request/response
contract stays the same as a reimplementation, not a redesign).

## `GET /`

### Query Parameters

| Name          | Type   | Required | Description                                  |
|---------------|--------|----------|-----------------------------------------------|
| username      | string | yes      | Username to look up                          |
| service       | string | yes      | Service the username belongs to              |
| password_hash | string | yes      | Cisco type 8 or type 9 hash to verify against |

### Response `200 OK` (application/json)

**On match**:
```json
{ "status": "pass", "hash": "<the submitted password_hash, unchanged>" }
```

**On mismatch**:
```json
{ "status": "fail", "hash": "<a freshly generated type 8 hash of the real stored password>" }
```

### Example Requests

```
GET /?username=localuser&service=router&password_hash=$9$UK9FYKZUD.n94E$qcLQeaiNaUjVj181Q8Hh2cUya7qdMV4q.qszxl3H0Ha
→ { "status": "fail", "hash": "$8$..." }

GET /?username=localuser&service=router&password_hash=$8$LkGlosq.R44sx.$VLpv7K56GEx6jhU4aMKgsGXvMo1n1EE/fElkbpJXQfY
→ { "status": "pass", "hash": "$8$LkGlosq.R44sx.$VLpv7K56GEx6jhU4aMKgsGXvMo1n1EE/fElkbpJXQfY" }
```
