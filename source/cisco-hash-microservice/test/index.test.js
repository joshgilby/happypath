'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.CREDENTIAL_STORE_PATH = path.join(os.tmpdir(), 'index.test.enc.json');
process.env.CREDENTIAL_STORE_PASSWORD = 'test-passphrase';

const { setPassword } = require('../credentialStore');
const { generateType8Hash, verifyPassword } = require('../ciscoHash');

setPassword('router', 'localuser', 'weakpassword');

const app = require('../index');

let server;
let baseUrl;

test.before(() => {
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(process.env.CREDENTIAL_STORE_PATH, { force: true });
});

test('returns pass and echoes the hash when it matches the stored password', async () => {
  const matchingHash = generateType8Hash('weakpassword');

  const start = Date.now();
  const response = await fetch(
    `${baseUrl}/?username=localuser&service=router&password_hash=${encodeURIComponent(matchingHash)}`
  );
  const body = await response.json();

  assert.ok(Date.now() - start < 1000);
  assert.equal(body.status, 'pass');
  assert.equal(body.hash, matchingHash);
});

test('returns fail and a valid regenerated hash when it does not match', async () => {
  const wrongHash = generateType8Hash('not-the-real-password');

  const start = Date.now();
  const response = await fetch(
    `${baseUrl}/?username=localuser&service=router&password_hash=${encodeURIComponent(wrongHash)}`
  );
  const body = await response.json();

  assert.ok(Date.now() - start < 1000);
  assert.equal(body.status, 'fail');
  // FR-009: the regenerated hash must itself be valid for the real stored password.
  assert.ok(verifyPassword('weakpassword', body.hash));
});

// US2: replays the example requests documented in tests.sh against the existing Python
// service, confirming the Node reimplementation produces the same status for each.
test('matches the existing service on its documented example requests', async () => {
  const type9Hash =
    '$9$UK9FYKZUD.n94E$qcLQeaiNaUjVj181Q8Hh2cUya7qdMV4q.qszxl3H0Ha'; // documented: should fail
  const type8Hash =
    '$8$LkGlosq.R44sx.$VLpv7K56GEx6jhU4aMKgsGXvMo1n1EE/fElkbpJXQfY'; // documented: should pass

  const failResponse = await fetch(
    `${baseUrl}/?username=localuser&service=router&password_hash=${encodeURIComponent(type9Hash)}`
  );
  const passResponse = await fetch(
    `${baseUrl}/?username=localuser&service=router&password_hash=${encodeURIComponent(type8Hash)}`
  );

  assert.equal((await failResponse.json()).status, 'fail');
  assert.equal((await passResponse.json()).status, 'pass');
});
