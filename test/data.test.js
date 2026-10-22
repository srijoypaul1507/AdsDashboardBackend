const test = require('node:test');
const assert = require('node:assert');
const { cached, clearCache } = require('../lib/cache');

test('cache: concurrent callers share one load, fresh hits skip the loader', async () => {
  clearCache();
  let calls = 0;
  const loader = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return 'v'; };
  const [a, b] = await Promise.all([
    cached('k', loader, { ttlMs: 1000 }),
    cached('k', loader, { ttlMs: 1000 }),
  ]);
  assert.strictEqual(a.value, 'v');
  assert.strictEqual(b.value, 'v');
  await cached('k', loader, { ttlMs: 1000 });
  assert.strictEqual(calls, 1);
});

test('cache: serves a flagged stale copy when reload fails', async () => {
  clearCache();
  await cached('s', async () => 'old', { ttlMs: 1000 });
  const r = await cached('s', async () => { throw new Error('boom'); }, { ttlMs: 0, maxStaleMs: 60000 });
  assert.deepStrictEqual([r.value, r.stale], ['old', true]);
});

test('cache: refresh:false returns an existing copy without loading', async () => {
  clearCache();
  await cached('w', async () => 'old', { ttlMs: 1000 });
  let called = false;
  const r = await cached('w', async () => { called = true; return 'new'; }, { ttlMs: 0, maxStaleMs: 60000, refresh: false });
  assert.deepStrictEqual([r.value, r.stale, called], ['old', true, false]);
});

test('cache: refresh:true waits for the full load', async () => {
  clearCache();
  await cached('f', async () => 'old', { ttlMs: 1000 });
  const slow = () => new Promise((r) => setTimeout(() => r('new'), 100));
  const r = await cached('f', slow, { ttlMs: 0, maxStaleMs: 60000, refresh: true });
  assert.deepStrictEqual([r.value, r.stale], ['new', false]);
});

test('cache: a stuck in-flight load is replaced after inflightTimeoutMs', async () => {
  clearCache();
  cached('s2', () => new Promise(() => {}), { ttlMs: 1000, inflightTimeoutMs: 20 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 40));
  const r = await cached('s2', async () => 'fresh', { ttlMs: 1000, inflightTimeoutMs: 20 });
  assert.strictEqual(r.value, 'fresh');
});

test('cache: with no stale copy, a failed load is an error', async () => {
  clearCache();
  await assert.rejects(cached('e', async () => { throw new Error('down'); }, { ttlMs: 1000 }), /down/);
});

test('getSpend: only fetches missing days and reports failures', async () => {
  const fb = require('../facebook_Ads');
  const google = require('../googleAds');
  const calls = [];
  fb.getDailySpend = async (s, e) => { calls.push([s, e]); return [{ date: '2025-01-02', campaign: 'BLR Leads', cost: 10, clicks: 1 }]; };
  google.getDailySpend = async () => { throw new Error('Google Ads: quota'); };
  delete require.cache[require.resolve('../lib/data')];
  const { getSpend } = require('../lib/data');

  const first = await getSpend('facebook', '2025-01-01', '2025-01-03');
  assert.deepStrictEqual(first.rows, [{ date: '2025-01-02', campaign: 'BLR Leads', cost: 10, clicks: 1 }]);
  assert.strictEqual(first.error, null);

  await getSpend('facebook', '2025-01-02', '2025-01-03'); // all old days cached
  await getSpend('facebook', '2025-01-02', '2025-01-05'); // only 04..05 missing
  assert.deepStrictEqual(calls, [['2025-01-01', '2025-01-03'], ['2025-01-04', '2025-01-05']]);

  const g = await getSpend('google', '2025-01-01', '2025-01-03');
  assert.match(g.error, /quota.*3 of 3 days missing/);
});

test('getCityMap: Zoho mapping when available, built-in mapping on failure, never throws', async () => {
  const axios = require('axios');
  const realGet = axios.get;
  const zohoReply = (rows) => ({ data: { details: { output: JSON.stringify({ rows }) } } });
  try {
    delete process.env.ZOHO_CITY_MAPPING_API;
    delete require.cache[require.resolve('../lib/data')];
    let { getCityMap } = require('../lib/data');
    assert.strictEqual((await getCityMap()).map.source, 'default'); // not configured

    process.env.ZOHO_CITY_MAPPING_API = 'https://example.test/mapping';
    clearCache();
    delete require.cache[require.resolve('../lib/data')];
    ({ getCityMap } = require('../lib/data'));
    axios.get = async () => { throw new Error('timeout'); };
    let r = await getCityMap();
    assert.strictEqual(r.map.source, 'default');
    assert.match(r.error, /built-in mapping/);

    let calls = 0;
    axios.get = async () => { calls++; return zohoReply([{ assignee: 'shreya shreya', city: 'Hosur', from: '2020-01-01' }]); };
    r = await getCityMap(); // within the retry pause: no call, still the built-in mapping
    assert.strictEqual(calls, 0);
    r = await getCityMap({ refresh: true }); // the warm-up always reloads
    assert.strictEqual(r.map.source, 'zoho');
    assert.strictEqual(r.map.cityForLead('shreya shreya', null, '2026-10-01'), 'Hosur');
    r = await getCityMap(); // requests reuse the cached copy
    assert.strictEqual(calls, 1);
    assert.strictEqual(r.error, null);

    axios.get = async () => { throw new Error('down'); };
    r = await getCityMap({ refresh: true }); // reload fails: last good copy is kept
    assert.strictEqual(r.map.source, 'zoho');
    assert.match(r.error, /last loaded copy/);
  } finally {
    axios.get = realGet;
    delete process.env.ZOHO_CITY_MAPPING_API;
  }
});
