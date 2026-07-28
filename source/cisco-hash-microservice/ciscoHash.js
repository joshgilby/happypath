'use strict';

const crypto = require('crypto');

const STD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const CISCO_ALPHABET = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const TYPE8_ITERATIONS = 20000;
const TYPE8_SALT_BYTES = 10;
const DIGEST_BYTES = 32;
const TYPE9_SCRYPT_OPTIONS = { N: 16384, r: 1, p: 1 };

function cisco64Encode(buffer) {
  const std = buffer.toString('base64');
  let out = '';
  for (const char of std) {
    if (char === '=') continue;
    out += CISCO_ALPHABET[STD_ALPHABET.indexOf(char)];
  }
  return out;
}

function cisco64Decode(text) {
  let std = '';
  for (const char of text) {
    std += STD_ALPHABET[CISCO_ALPHABET.indexOf(char)];
  }
  while (std.length % 4 !== 0) {
    std += '=';
  }
  return Buffer.from(std, 'base64');
}

function deriveType8(password, salt, keylen) {
  return crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), salt, TYPE8_ITERATIONS, keylen, 'sha256');
}

function deriveType9(password, salt, keylen) {
  return crypto.scryptSync(Buffer.from(password, 'utf8'), salt, keylen, TYPE9_SCRYPT_OPTIONS);
}

function generateType8Hash(password) {
  const salt = crypto.randomBytes(TYPE8_SALT_BYTES);
  const digest = deriveType8(password, salt, DIGEST_BYTES);
  return `$8$${cisco64Encode(salt)}$${cisco64Encode(digest)}`;
}

function verifyPassword(password, hash) {
  const [, type, saltText, digestText] = hash.split('$');
  const salt = cisco64Decode(saltText);
  const expectedDigest = cisco64Decode(digestText);

  const derive = type === '8' ? deriveType8 : deriveType9;
  const actualDigest = derive(password, salt, expectedDigest.length);
  return crypto.timingSafeEqual(actualDigest, expectedDigest);
}

module.exports = { verifyPassword, generateType8Hash };
