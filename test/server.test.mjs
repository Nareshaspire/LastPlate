import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../server.mjs';

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('GET /api/config returns valid platform configuration', async () => {
  const res = await fetch(`${baseUrl}/api/config`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(typeof data.currency, 'string');
  assert.equal(typeof data.paypalConfigured, 'boolean');
});

test('GET /api/listings returns active listings with geolocation and dietary metadata', async () => {
  const res = await fetch(`${baseUrl}/api/listings`);
  assert.equal(res.status, 200);
  const listings = await res.json();
  assert.ok(Array.isArray(listings));
  assert.ok(listings.length > 0, 'Catalog should contain seed listings');
  
  const sample = listings[0];
  assert.ok(sample.id);
  assert.ok(sample.title);
  assert.ok(sample.shop);
  assert.equal(typeof sample.price, 'number');
  assert.equal(typeof sample.lat, 'number');
  assert.equal(typeof sample.lng, 'number');
  assert.ok(Array.isArray(sample.dietary));
});

test('POST /api/ai/recommend handles queries with valid fallback matches', async () => {
  const res = await fetch(`${baseUrl}/api/ai/recommend`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'croissant under $10' })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.message);
  assert.ok(Array.isArray(data.recommendations));
});

test('POST /api/orders/create reserves a demo order and generates a pickup code', async () => {
  const listingsRes = await fetch(`${baseUrl}/api/listings`);
  const listings = await listingsRes.json();
  const listingId = listings[0].id;

  const orderRes = await fetch(`${baseUrl}/api/orders/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ listingId, quantity: 1, buyerName: 'Test Buyer' })
  });
  assert.equal(orderRes.status, 200);
  const order = await orderRes.json();
  assert.ok(order.id);
  assert.ok(order.pickupCode);
  assert.match(order.pickupCode, /^LP-[A-Z0-9]+$/);
});

