'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.CREDENTIAL_STORE_PATH = path.join(os.tmpdir(), 'credentialStore.test.enc.json');
process.env.CREDENTIAL_STORE_PASSWORD = 'correct-passphrase';

const { setPassword, getPassword, STORE_PATH } = require('../credentialStore');

test.after(() => {
  fs.rmSync(STORE_PATH, { force: true });
});

test('fails to decrypt with the wrong passphrase', () => {
  setPassword('router', 'localuser', 'weakpassword');

  process.env.CREDENTIAL_STORE_PASSWORD = 'wrong-passphrase';
  assert.throws(() => getPassword('router', 'localuser'));
  process.env.CREDENTIAL_STORE_PASSWORD = 'correct-passphrase';
});

test('fails to decrypt with a missing passphrase', () => {
  delete process.env.CREDENTIAL_STORE_PASSWORD;
  assert.throws(() => getPassword('router', 'localuser'));
  process.env.CREDENTIAL_STORE_PASSWORD = 'correct-passphrase';
});
