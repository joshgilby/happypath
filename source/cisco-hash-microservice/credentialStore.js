'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_PATH = process.env.CREDENTIAL_STORE_PATH || path.join(__dirname, 'credentials.enc.json');

function deriveKey(salt) {
  const passphrase = process.env.CREDENTIAL_STORE_PASSWORD;
  return crypto.scryptSync(passphrase, salt, 32);
}

function readCredentials() {
  const envelope = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  const salt = Buffer.from(envelope.salt, 'hex');
  const iv = Buffer.from(envelope.iv, 'hex');
  const authTag = Buffer.from(envelope.authTag, 'hex');
  const key = deriveKey(salt);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'hex')),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8'));
}

function writeCredentials(credentials) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credentials), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const envelope = {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
  fs.writeFileSync(STORE_PATH, JSON.stringify(envelope));
}

function getPassword(service, username) {
  const credentials = readCredentials();
  return credentials[service][username];
}

function setPassword(service, username, password) {
  const credentials = fs.existsSync(STORE_PATH) ? readCredentials() : {};
  if (!credentials[service]) {
    credentials[service] = {};
  }
  credentials[service][username] = password;
  writeCredentials(credentials);
}

module.exports = { getPassword, setPassword, STORE_PATH };
