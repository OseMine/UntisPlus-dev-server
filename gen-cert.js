const crypto = require('crypto');
const fs = require('fs');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
fs.writeFileSync('key.pem', privateKey.export({ type: 'pkcs1', format: 'pem' }));
fs.writeFileSync('cert.pem', publicKey.export({ type: 'spki', format: 'pem' }));
console.log('Generated key.pem and cert.pem');