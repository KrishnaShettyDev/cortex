#!/usr/bin/env node

/**
 * Create test user and generate JWT token for cache testing
 */

import { createHmac } from 'crypto';

// User data
const testUser = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'test@cortex.local',
  name: 'Test User',
  provider: 'test',
  provider_user_id: 'test-001',
};

// Simple JWT creation without dependencies
function createJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };

  const base64UrlEncode = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

  const encodedHeader = base64UrlEncode(header);
  const encodedPayload = base64UrlEncode(payload);
  const data = `${encodedHeader}.${encodedPayload}`;

  const signature = createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${data}.${signature}`;
}

// Generate JWT token
const JWT_SECRET = 'test-secret-' + Date.now();

const payload = {
  sub: testUser.id,
  email: testUser.email,
  name: testUser.name,
  type: 'access',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 7200, // 2 hours
};

const token = createJWT(payload, JWT_SECRET);

console.log('\n🔐 JWT Secret (save this - you\'ll need it):');
console.log(JWT_SECRET);

console.log('\n👤 Test User:');
console.log(JSON.stringify(testUser, null, 2));

console.log('\n🎫 JWT Token:');
console.log(token);

const timestamp = new Date().toISOString();
console.log('\n📝 Step 1: Create user in database');
console.log(`npx wrangler d1 execute cortex-production --remote --command "INSERT INTO users (id, email, name, provider, provider_user_id, created_at, updated_at) VALUES ('${testUser.id}', '${testUser.email}', '${testUser.name}', '${testUser.provider}', '${testUser.provider_user_id}', '${timestamp}', '${timestamp}')"`);

console.log('\n🔑 Step 2: Set JWT secret in Cloudflare');
console.log('Run: npx wrangler secret put JWT_SECRET');
console.log(`When prompted, paste: ${JWT_SECRET}`);

console.log('\n\n🧪 Step 3: Test the caching layer\n');

console.log('Test 1: Verify authentication works');
console.log(`curl https://askcortex.plutas.in/auth/me \\
  -H "Authorization: Bearer ${token}"`);

console.log('\n\nTest 2: Save a memory (embedding cache miss expected)');
console.log(`curl -X POST https://askcortex.plutas.in/v3/memories \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "I love pizza and pasta. My favorite restaurant is Tony'\''s Pizza in San Francisco."}'`);

console.log('\n\nTest 3: Save another memory (embedding cache miss expected)');
console.log(`curl -X POST https://askcortex.plutas.in/v3/memories \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "I work as a software engineer at Google. I love building AI products."}'`);

console.log('\n\nTest 4: Search - first time (cache miss expected)');
console.log(`curl "https://askcortex.plutas.in/v3/memories?query=What+food+do+I+like" \\
  -H "Authorization: Bearer ${token}"`);

console.log('\n\nTest 5: Search - same query (cache HIT expected!)');
console.log(`curl "https://askcortex.plutas.in/v3/memories?query=What+food+do+I+like" \\
  -H "Authorization: Bearer ${token}"`);

console.log('\n\nTest 6: Search - different query (cache miss expected)');
console.log(`curl "https://askcortex.plutas.in/v3/memories?query=Where+do+I+work" \\
  -H "Authorization: Bearer ${token}"`);

console.log('\n\nTest 7: Search - same query again (cache HIT expected!)');
console.log(`curl "https://askcortex.plutas.in/v3/memories?query=Where+do+I+work" \\
  -H "Authorization: Bearer ${token}"`);

console.log('\n\n📊 Monitor cache performance');
console.log('Run in another terminal: npx wrangler tail cortex-api --format pretty');
console.log('\nLook for these log messages:');
console.log('  ✅ Cache HIT: [Cache] Embedding cache hit');
console.log('  ❌ Cache MISS: [Cache] Embedding cache miss, generating...');
console.log('  ✅ Cache HIT: [Cache] Search results cache hit');
console.log('  ❌ Cache MISS: [Cache] Search results cache miss, executing search...');
console.log('  ℹ️  Cache invalidation: [Processor] Profile cache invalidated for user');
console.log('\n');

// Save token to file for easy reuse
import { writeFileSync } from 'fs';
writeFileSync('/tmp/cortex-test-token.txt', token);
writeFileSync('/tmp/cortex-test-secret.txt', JWT_SECRET);
console.log('💾 Token saved to: /tmp/cortex-test-token.txt');
console.log('💾 Secret saved to: /tmp/cortex-test-secret.txt\n');
