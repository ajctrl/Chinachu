'use strict';
const { hashPassword } = require('../../lib/password-auth');
module.exports = { users: [{ username: 'alice', passwordHash: hashPassword('secret') }] };
