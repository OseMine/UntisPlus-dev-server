const selfsigned = require('selfsigned');
const fs = require('fs');
require('dotenv').config();

async function main() {
  const sans = (process.env.SSL_SANS || 'localhost,127.0.0.1,0.0.0.0')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const attrs = [{ name: 'commonName', value: 'Untis+ Dev Server' }];
  const options = {
    days: 365,
    keySize: 2048,
    subjectAltName: sans.map(value => ({ type: 2, value }))
  };
  const pems = await selfsigned.generate(attrs, options);
  fs.writeFileSync('key.pem', pems.private);
  fs.writeFileSync('cert.pem', pems.cert);
  console.log('Generated key.pem and cert.pem with SANs:', sans.join(', '));
}

main().catch(console.error);