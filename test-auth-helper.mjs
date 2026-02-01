#!/usr/bin/env node

/**
 * Helper to get auth token for testing
 *
 * This will help you authenticate and get a JWT token
 */

console.log('🔐 Cortex Auth Helper\n');
console.log('To test the cache, you need to authenticate first.\n');
console.log('Options:\n');
console.log('1. Login via mobile app and extract token from device');
console.log('2. Use Google OAuth (need Google ID token)');
console.log('3. Use Apple Sign In (need Apple identity token)\n');

console.log('For testing, the easiest way is:\n');
console.log('Option A: If you have the mobile app installed:');
console.log('  - Open the app and login');
console.log('  - The JWT token is stored in secure storage');
console.log('  - On iOS: Check Keychain');
console.log('  - On Android: Check SharedPreferences\n');

console.log('Option B: Use Google OAuth flow:');
console.log('  1. Go to https://developers.google.com/oauthplayground');
console.log('  2. Authorize Google APIs');
console.log('  3. Get your ID token');
console.log('  4. Run: curl -X POST https://askcortex.plutas.in/auth/google \\');
console.log('       -H "Content-Type: application/json" \\');
console.log('       -d \'{"idToken":"YOUR_GOOGLE_ID_TOKEN"}\'');
console.log('  5. Copy the access_token from response\n');

console.log('Once you have a token, run:');
console.log('  TEST_TOKEN=your_token node test-cache.mjs\n');

console.log('Or use the quick test:');
console.log('  ./quick-test.sh\n');
