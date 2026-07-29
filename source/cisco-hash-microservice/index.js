'use strict';

const express = require('express');
const { getPassword } = require('./credentialStore');
const { verifyPassword, generateType8Hash } = require('./ciscoHash');

const app = express();

app.get('/', (req, res) => {
  const { username, service, password_hash: passwordHash } = req.query;
  const password = getPassword(service, username);

  if (verifyPassword(password, passwordHash)) {
    res.json({ status: 'pass', hash: passwordHash });
  } else {
    res.json({ status: 'fail', hash: generateType8Hash(password) });
  }
});

if (require.main === module) {
  const port = process.env.HASH_SERVICE_PORT || 8000;
  app.listen(port);
}

module.exports = app;
