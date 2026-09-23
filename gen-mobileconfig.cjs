const fs = require('fs');

const certPem = fs.readFileSync('cert.pem', 'utf8');
const certBase64 = certPem
  .replace('-----BEGIN CERTIFICATE-----', '')
  .replace('-----END CERTIFICATE-----', '')
  .replace(/\n/g, '');

const uuid1 = 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890';
const uuid2 = 'B2C3D4E5-F6A7-8901-BCDE-F23456789012';

const mobileconfig = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>PayloadCertificateFileName</key>
            <string>UntisPlusDevCA.cer</string>
            <key>PayloadContent</key>
            <data>${certBase64}</data>
            <key>PayloadDescription</key>
            <string>Installs UntisPlus Dev CA certificate</string>
            <key>PayloadDisplayName</key>
            <string>UntisPlus Dev CA</string>
            <key>PayloadIdentifier</key>
            <string>com.untisplus.dev.ca</string>
            <key>PayloadType</key>
            <string>com.apple.security.root</string>
            <key>PayloadUUID</key>
            <string>${uuid1}</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
        </dict>
    </array>
    <key>PayloadDescription</key>
    <string>UntisPlus Dev Server Certificate</string>
    <key>PayloadDisplayName</key>
    <string>UntisPlus Dev Certificate</string>
    <key>PayloadIdentifier</key>
    <string>com.untisplus.dev.cert</string>
    <key>PayloadRemovalDisallowed</key>
    <false/>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>${uuid2}</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>`;

fs.writeFileSync('UntisPlusDevCert.mobileconfig', mobileconfig);
console.log('Created UntisPlusDevCert.mobileconfig - AirDrop this to iPhone');