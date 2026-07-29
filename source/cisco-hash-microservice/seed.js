'use strict';

const { setPassword } = require('./credentialStore');

const [service, username, password] = process.argv.slice(2);
setPassword(service, username, password);
