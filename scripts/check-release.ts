import 'dotenv/config';
import { createPrivateKey } from 'node:crypto';

// Read-only validation. Never print credentials or connect to the database.
let failures = 0;
function check(name: string, valid: boolean, help: string) {
  console.log(`${valid ? 'PASS' : 'MISSING/INVALID'}: ${name}${valid ? '' : ` — ${help}`}`);
  if (!valid) failures++;
}
const support = process.env.SUPPORT_EMAIL?.trim() || '';
check('SUPPORT_EMAIL', /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(support), 'Set a monitored support mailbox on the production host.');
check('CRON_SECRET', (process.env.CRON_SECRET?.trim().length || 0) >= 32, 'Set a random secret of at least 32 characters for maintenance.');
check('JWT_SECRET', (process.env.JWT_SECRET?.length || 0) >= 32, 'Use a strong signing secret; rotating it invalidates current sessions.');
check('Database configuration', Boolean(process.env.DATABASE_URL?.trim() || (process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD)), 'Configure the intended production database.');
check('GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL', /^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL?.trim() || ''), 'Configure the Play-authorized service account for listing-credit purchases.');
let keyValid = false;
try { keyValid = createPrivateKey(process.env.GOOGLE_PLAY_PRIVATE_KEY?.replace(/\\n/g, '\n') || '').asymmetricKeyType === 'rsa'; } catch { /* Report the key name only. */ }
check('GOOGLE_PLAY_PRIVATE_KEY', keyValid, 'Configure the matching RSA private key securely on the host.');

if (process.argv.includes('--online')) {
  const website = 'https://property-setu-ps.vercel.app';
  const backend = 'https://property-setu-backend.vercel.app';
  for (const path of ['/privacy', '/terms', '/delete-account']) {
    try {
      const response = await fetch(`${website}${path}`, { signal: AbortSignal.timeout(15000) });
      const text = await response.text();
      check(`Public ${path}`, response.ok && response.url.startsWith('https://') && text.includes('PropertySetu'), 'Deploy the public page; it must load without authentication.');
    } catch { check(`Public ${path}`, false, 'Could not verify connectivity from this environment.'); }
  }
  try {
    const response = await fetch(`${backend}/api/legal`, { signal: AbortSignal.timeout(15000) });
    const result = await response.json() as { support_email?: string };
    check('Deployed support contact', response.ok && Boolean(result.support_email), 'Configure SUPPORT_EMAIL in the backend deployment.');
  } catch { check('Deployed support contact', false, 'Could not verify the deployed backend from this environment.'); }
}

console.log('Manual checks: reviewer/demo login, deployed migrations, cleanup job execution, Play product permissions and purchases, signed AAB/16 KB compatibility, pre-launch report and Console declarations.');
console.log('This check does not deploy, migrate, delete accounts, send email or perform purchases. Run it on the production host to validate that host’s environment.');
process.exitCode = failures ? 1 : 0;
