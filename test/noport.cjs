// test/noport.cjs : loaded before server.js when a test runs `node server.js --check` (node -r ./test/noport.cjs):
// binding a port or asking the network for anything (an email is a fetch to Resend, a payment a fetch to Stripe) ends
// the process at once with its own exit code, so "it binds no port and sends no email" is something the test sees,
// not something it is told.
'use strict';
require('net').Server.prototype.listen = function () { console.error('A PORT WAS BOUND'); process.exit(97); };
global.fetch = function (u) { console.error('THE NETWORK WAS ASKED FOR ' + u); process.exit(98); };
