#!/usr/bin/env npx tsx
/**
 * Generate a JWT token for testing
 *
 * Uses the same token format as src/auth.ts:
 * - Algorithm: HS256
 * - Payload: { sub: userId, email, name }
 * - Expiry: Configurable (default 24h for testing, prod uses 30m)
 *
 * Usage:
 *   JWT_SECRET=your-secret npx tsx scripts/generate-token.ts [user-email] [expiry]
 *
 * Examples:
 *   JWT_SECRET=xxx npx tsx scripts/generate-token.ts
 *   JWT_SECRET=xxx npx tsx scripts/generate-token.ts plutaslab@gmail.com
 *   JWT_SECRET=xxx npx tsx scripts/generate-token.ts plutaslab@gmail.com 7d
 *
 * To get your JWT_SECRET:
 *   - Check where you originally stored it when running `wrangler secret put JWT_SECRET`
 *   - Or generate a new one: openssl rand -base64 32
 *     Then update: npx wrangler secret put JWT_SECRET
 */

import { SignJWT } from 'jose';
import { execSync } from 'child_process';

// ANSI colors
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

async function main() {
  console.log('');
  console.log(`${BLUE}${BOLD}🔐 CORTEX TOKEN GENERATOR${RESET}`);
  console.log('═'.repeat(50));
  console.log('');

  // Get JWT_SECRET from environment
  const JWT_SECRET = process.env.JWT_SECRET;

  if (!JWT_SECRET) {
    console.error(`${RED}❌ JWT_SECRET environment variable is required${RESET}`);
    console.log('');
    console.log(`${YELLOW}Usage:${RESET}`);
    console.log(`  JWT_SECRET=your-secret npx tsx scripts/generate-token.ts [email] [expiry]`);
    console.log('');
    console.log(`${YELLOW}To find your JWT_SECRET:${RESET}`);
    console.log('  - Check where you stored it when you ran: wrangler secret put JWT_SECRET');
    console.log('  - Or generate a new one: openssl rand -base64 32');
    console.log('');
    process.exit(1);
  }

  // Fetch users from D1 database
  console.log(`${CYAN}📡 Fetching users from D1 database...${RESET}`);

  let users: Array<{ id: string; email: string; name: string | null }> = [];

  try {
    const result = execSync(
      'npx wrangler d1 execute cortex-production --remote --json --command "SELECT id, email, name FROM users LIMIT 10"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const parsed = JSON.parse(result);
    users = parsed[0]?.results || [];
  } catch (error: any) {
    console.error(`${RED}❌ Failed to fetch users: ${error.message}${RESET}`);
    console.log('');
    console.log(`${YELLOW}Falling back to hardcoded user list...${RESET}`);

    // Fallback users
    users = [
      { id: '00000000-0000-0000-0000-000000000001', email: 'test@cortex.local', name: 'Test User' },
      { id: 'f647e7d9-47e4-4be3-bf29-8ccea7e8734b', email: 'krishnashetty.strive@gmail.com', name: 'Krishna Shetty' },
      { id: '79f149ea-6c24-45df-a029-fc1483fe1192', email: 'plutaslab@gmail.com', name: 'Plutas Lab' },
    ];
  }

  if (users.length === 0) {
    console.error(`${RED}❌ No users found in database${RESET}`);
    process.exit(1);
  }

  // Show available users
  console.log('');
  console.log(`${GREEN}✓ Found ${users.length} user(s):${RESET}`);
  users.forEach((u, i) => {
    console.log(`  ${i + 1}. ${u.email} (${u.name || 'No name'})`);
  });
  console.log('');

  // Get target user from args
  const targetEmail = process.argv[2] || users[0].email;
  const expiry = process.argv[3] || '24h';

  const user = users.find((u) => u.email === targetEmail);

  if (!user) {
    console.error(`${RED}❌ User not found: ${targetEmail}${RESET}`);
    console.log(`${YELLOW}Available emails:${RESET} ${users.map((u) => u.email).join(', ')}`);
    process.exit(1);
  }

  // Generate token using jose (same as src/auth.ts)
  console.log(`${CYAN}🔑 Generating token for: ${user.email}${RESET}`);

  const secretKey = new TextEncoder().encode(JWT_SECRET);

  const token = await new SignJWT({
    sub: user.id,
    email: user.email,
    name: user.name,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(secretKey);

  // Output
  console.log('');
  console.log(`${GREEN}${BOLD}✓ Token generated successfully!${RESET}`);
  console.log('');
  console.log(`${BOLD}User:${RESET}    ${user.email}`);
  console.log(`${BOLD}User ID:${RESET} ${user.id}`);
  console.log(`${BOLD}Expiry:${RESET}  ${expiry}`);
  console.log('');
  console.log('─'.repeat(50));
  console.log(`${BOLD}TOKEN:${RESET}`);
  console.log('');
  console.log(token);
  console.log('');
  console.log('─'.repeat(50));
  console.log('');
  console.log(`${YELLOW}Export it:${RESET}`);
  console.log(`  export TOKEN="${token}"`);
  console.log('');
  console.log(`${YELLOW}Test it:${RESET}`);
  console.log(`  curl -s https://askcortex.plutas.in/auth/me -H "Authorization: Bearer $TOKEN" | jq`);
  console.log('');
}

main().catch((err) => {
  console.error(`${RED}❌ Error: ${err.message}${RESET}`);
  process.exit(1);
});
