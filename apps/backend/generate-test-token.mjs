#!/usr/bin/env node
/**
 * Generate a test JWT token for API testing
 * This creates a temporary access token that can be used to generate a long-lived API key
 */

import { SignJWT } from 'jose';

// User ID from the database (plutaslab@gmail.com)
const userId = '79f149ea-6c24-45df-a029-fc1483fe1192';
const email = 'plutaslab@gmail.com';
const name = 'Plutas Lab';

console.log('\n🔐 Generating Test Access Token...\n');

// You need to set JWT_SECRET environment variable
const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
  console.error('❌ ERROR: JWT_SECRET environment variable not set\n');
  console.log('Get it from Cloudflare:\n');
  console.log('  npx wrangler secret list\n');
  console.log('Then set it:');
  console.log('  export JWT_SECRET="your-secret-here"\n');
  process.exit(1);
}

try {
  const secret = new TextEncoder().encode(jwtSecret);

  // Generate access token (short-lived)
  const accessToken = await new SignJWT({
    sub: userId,
    email: email,
    name: name,
    type: 'access',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secret);

  console.log('✅ Access Token Generated!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('User:', name);
  console.log('Email:', email);
  console.log('User ID:', userId);
  console.log('\nAccess Token (valid 24h):\n');
  console.log(accessToken);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Next steps:\n');
  console.log('1. Generate long-lived API key:');
  console.log(`   ./get-api-key.sh ${accessToken}\n`);
  console.log('2. Or use directly:');
  console.log(`   export CORTEX_API_KEY="${accessToken}"`);
  console.log('   ./test-e2e-pipeline.sh\n');

} catch (err) {
  console.error('❌ Error generating token:', err.message);
  process.exit(1);
}
