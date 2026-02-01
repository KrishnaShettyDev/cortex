#!/usr/bin/env node

/**
 * Cortex Cache Test Suite
 *
 * Tests:
 * 1. Embedding cache (same text = cached embedding)
 * 2. Profile cache (repeated profile fetches)
 * 3. Search cache (identical searches)
 * 4. Cache invalidation (new memory invalidates profile)
 */

const API_URL = 'https://askcortex.plutas.in';

// Test credentials - use your actual test account
const TEST_EMAIL = process.env.TEST_EMAIL || 'test@example.com';
const TEST_TOKEN = process.env.TEST_TOKEN;

if (!TEST_TOKEN) {
  console.error('❌ Error: TEST_TOKEN environment variable required');
  console.error('Usage: TEST_TOKEN=your_jwt_token node test-cache.mjs');
  process.exit(1);
}

async function makeRequest(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`;
  const headers = {
    'Authorization': `Bearer ${TEST_TOKEN}`,
    'Content-Type': 'application/json',
    ...options.headers
  };

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return response.json();
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('🧪 Cortex Cache Test Suite\n');

  const containerTag = `test_${Date.now()}`;
  console.log(`Using container tag: ${containerTag}\n`);

  // Test 1: Add memory (generates embedding - cache miss)
  console.log('📝 Test 1: Add memory (embedding cache miss expected)');
  const memory1 = await makeRequest('/v3/memories', {
    method: 'POST',
    body: JSON.stringify({
      content: 'I prefer TypeScript for backend development',
      source: 'test',
      containerTag
    })
  });
  console.log(`✅ Memory created: ${memory1.id}`);
  console.log(`   Status: ${memory1.processing_status}`);
  console.log('⏳ Waiting 8 seconds for async processing...\n');
  await sleep(8000);

  // Test 2: Search (first time - cache miss)
  console.log('🔍 Test 2: Search query (cache miss expected)');
  const start1 = Date.now();
  const search1 = await makeRequest('/v3/search', {
    method: 'POST',
    body: JSON.stringify({
      q: 'programming language preferences',
      containerTag,
      searchMode: 'hybrid',
      includeProfile: true,
      limit: 5
    })
  });
  const elapsed1 = Date.now() - start1;
  console.log(`✅ Search completed in ${elapsed1}ms (backend: ${search1.timing}ms)`);
  console.log(`   Results: ${search1.total} total (${search1.memories.length} memories, ${search1.chunks.length} chunks)`);
  console.log(`   Profile: ${search1.profile?.static?.length || 0} static, ${search1.profile?.dynamic?.length || 0} dynamic facts\n`);

  // Test 3: Same search (should be cached)
  console.log('🔍 Test 3: Same search again (CACHE HIT expected)');
  const start2 = Date.now();
  const search2 = await makeRequest('/v3/search', {
    method: 'POST',
    body: JSON.stringify({
      q: 'programming language preferences',
      containerTag,
      searchMode: 'hybrid',
      includeProfile: true,
      limit: 5
    })
  });
  const elapsed2 = Date.now() - start2;
  console.log(`✅ Search completed in ${elapsed2}ms (backend: ${search2.timing}ms)`);
  console.log(`   Results: ${search2.total} total`);

  if (elapsed2 < elapsed1) {
    console.log(`   🎉 CACHE WORKING! ${Math.round((1 - elapsed2/elapsed1) * 100)}% faster\n`);
  } else {
    console.log(`   ⚠️  No speedup detected (${elapsed2}ms vs ${elapsed1}ms)\n`);
  }

  // Test 4: Get profile (should be cached)
  console.log('👤 Test 4: Get profile (cache hit expected)');
  const start3 = Date.now();
  const profile1 = await makeRequest(`/v3/profile?containerTag=${containerTag}`);
  const elapsed3 = Date.now() - start3;
  console.log(`✅ Profile fetched in ${elapsed3}ms`);
  console.log(`   Static facts: ${profile1.static?.length || 0}`);
  console.log(`   Dynamic facts: ${profile1.dynamic?.length || 0}\n`);

  // Test 5: Add another memory (invalidates profile cache)
  console.log('📝 Test 5: Add another memory (should invalidate profile cache)');
  const memory2 = await makeRequest('/v3/memories', {
    method: 'POST',
    body: JSON.stringify({
      content: 'I am currently working on a memory layer project with caching',
      source: 'test',
      containerTag
    })
  });
  console.log(`✅ Memory created: ${memory2.id}`);
  console.log('⏳ Waiting 8 seconds for processing and cache invalidation...\n');
  await sleep(8000);

  // Test 6: Get profile again (cache should be invalidated)
  console.log('👤 Test 6: Get profile after invalidation (fresh data expected)');
  const start4 = Date.now();
  const profile2 = await makeRequest(`/v3/profile?containerTag=${containerTag}`);
  const elapsed4 = Date.now() - start4;
  console.log(`✅ Profile fetched in ${elapsed4}ms`);
  console.log(`   Static facts: ${profile2.static?.length || 0}`);
  console.log(`   Dynamic facts: ${profile2.dynamic?.length || 0}`);

  const factsChanged = (profile2.static?.length || 0) !== (profile1.static?.length || 0) ||
                       (profile2.dynamic?.length || 0) !== (profile1.dynamic?.length || 0);

  if (factsChanged) {
    console.log(`   ✅ Profile updated! Cache was invalidated correctly\n`);
  } else {
    console.log(`   ⚠️  Profile unchanged (facts may not have been extracted yet)\n`);
  }

  // Summary
  console.log('📊 Test Summary:');
  console.log(`   First search:  ${elapsed1}ms (cache miss)`);
  console.log(`   Second search: ${elapsed2}ms (cache hit)`);
  console.log(`   Speedup:       ${Math.round((1 - elapsed2/elapsed1) * 100)}%`);
  console.log(`   Profile facts: ${profile1.static?.length || 0} → ${profile2.static?.length || 0} static`);
  console.log('');
  console.log('💡 To see cache logs in real-time, run:');
  console.log('   npx wrangler tail --format=pretty');
  console.log('');
  console.log('Look for these log messages:');
  console.log('   [Cache] Embedding cache hit/miss');
  console.log('   [Cache] Profile cache hit/miss');
  console.log('   [Cache] Search results cache hit/miss');
}

// Run tests
runTests().catch(error => {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
});
