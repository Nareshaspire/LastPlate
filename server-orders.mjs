import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from './server.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const db = new Database(process.env.DATABASE_PATH || join(root, 'lastplate.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

// Keep the existing app and its middleware, but replace order handlers with the
// transactional implementations below. The original server is imported (not run).
const orderRoutes = new Set([
  '/api/orders',
  '/api/orders/create',
  '/api/orders/capture',
  '/api/orders/:id/status',
  '/api/seller/orders',
  '/api/seller/orders/verify'
]);
app._router.stack = app._router.stack.filter((layer) => !orderRoutes.has(layer.route?.path));

for (const [column, type] of [
  ['listing_title_snapshot', 'TEXT'],
  ['pickup_by_snapshot', 'TEXT'],
  ['address_snapshot', 'TEXT']
]) {
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN ${column} ${type}`);
  } catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error;
  }
}

const orderSchema = (await import('zod')).z.object({
  listingId: (await import('zod')).z.coerce.number().int().min(1),
  quantity: (await import('zod')).z.coerce.number().int().min(1).max(10),
  buyerName: (await import('zod')).z.string().trim().max(80).optional().default('Guest')
});
const statusSchema = (await import('zod')).z.object({
  status: (await import('zod')).z.enum(['ready', 'picked_up', 'cancelled'])
});
const paypalConfigured = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
const currency = process.env.CURRENCY || 'CAD';

function newPickupCode() {
  return `LP-${randomBytes(4).toString('hex').toUpperCase()}`;
}

function readListing(listingId) {
  return db.prepare('SELECT * FROM listings WHERE id = ? AND status = \'active\'').get(listingId);
}

function createReservedOrder({ listingId, quantity, buyerName = 'Guest', status = 'reserved' }) {
  const pickupCode = newPickupCode();
  return db.transaction(() => {
    const listing = readListing(listingId);
    if (!listing) return { error: 'Listing not found.', statusCode: 404 };
    const stockUpdate = db.prepare(`
      UPDATE listings SET quantity = quantity - ?
      WHERE id = ? AND status = 'active' AND quantity >= ?
    `).run(quantity, listingId, quantity);
    if (stockUpdate.changes !== 1) return { error: 'That bundle is no longer available in this quantity.', statusCode: 409 };

    const inserted = db.prepare(`
      INSERT INTO orders (
        listing_id, seller_id, buyer_name, quantity, total, status, pickup_code,
        listing_title_snapshot, pickup_by_snapshot, address_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      listing.id, listing.seller_id, buyerName || 'Guest', quantity,
      Number(listing.price) * quantity, status, pickupCode,
      listing.title, listing.pickup_by, listing.address
    );
    return {
      id: Number(inserted.lastInsertRowid), listingId: listing.id,
      sellerId: listing.seller_id, buyerName: buyerName || 'Guest', quantity,
      total: Number(listing.price) * quantity, status, pickupCode,
      title: listing.title, pickupBy: listing.pickup_by, address: listing.address
    };
  })();
}

function releaseOrderStock(orderId) {
  return db.transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order || !['created', 'reserved'].includes(order.status)) return false;
    const changed = db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ? AND status IN ('created', 'reserved')").run(orderId);
    if (changed.changes !== 1) return false;
    db.prepare('UPDATE listings SET quantity = quantity + ? WHERE id = ?').run(order.quantity, order.listing_id);
    return true;
  })();
}

function asOrder(row) {
  const title = row.listing_title_snapshot || row.listing_title || row.title || null;
  return {
    id: row.id,
    listingId: row.listing_id,
    title,
    listingTitle: title,
    sellerId: row.seller_id,
    buyerName: row.buyer_name || 'Guest',
    quantity: Number(row.quantity || 0),
    total: Number(row.total || 0),
    status: row.status,
    pickupCode: row.pickup_code,
    pickupBy: row.pickup_by_snapshot || row.pickup_by || 'Today, 7:00 pm',
    address: row.address_snapshot || row.address || '',
    createdAt: row.created_at,
    paypalOrderId: row.paypal_order_id || null
  };
}

async function paypalToken() {
  const credentials = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: { authorization: `Basic ${credentials}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.message || 'Could not connect to PayPal sandbox');
  return data.access_token;
}

async function createPayPalOrder(order) {
  const token = await paypalToken();
  const response = await fetch('https://api-m.sandbox.paypal.com/v2/checkout/orders', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: String(order.listingId),
        description: String(order.title).slice(0, 127),
        amount: { currency_code: currency, value: order.total.toFixed(2) },
        custom_id: `${order.listingId}:${order.quantity}`
      }]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || data.details?.[0]?.description || 'Could not create PayPal order');
  return data;
}

async function capturePayPalOrder(orderId) {
  const token = await paypalToken();
  const response = await fetch(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || data.details?.[0]?.description || 'Could not capture PayPal payment');
  return data;
}

function joinedOrder(orderId) {
  return db.prepare(`
    SELECT o.*, l.title AS listing_title, l.pickup_by, l.address
    FROM orders o JOIN listings l ON l.id = o.listing_id
    WHERE o.id = ?
  `).get(orderId);
}

app.get('/api/seller/orders', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Authentication required.' });
  const rows = db.prepare(`
    SELECT o.*, l.title AS listing_title, l.pickup_by, l.address
    FROM orders o JOIN listings l ON l.id = o.listing_id
    WHERE l.seller_id = ? AND o.status != 'created'
    ORDER BY o.created_at DESC
  `).all(req.session.userId);
  res.json({ orders: rows.map(asOrder) });
});

app.post('/api/orders', (req, res) => {
  try {
    const input = orderSchema.parse(req.body || {});
    const result = createReservedOrder(input);
    if (result.error) return res.status(result.statusCode).json({ error: result.error });
    return res.status(201).json({ order: result });
  } catch (error) {
    if (error.name === 'ZodError') return res.status(400).json({ error: error.errors[0]?.message || 'Invalid order.' });
    console.error('Could not create order:', error);
    return res.status(500).json({ error: 'Could not create order.' });
  }
});

app.post('/api/orders/create', async (req, res) => {
  let reserved;
  try {
    const input = orderSchema.parse({ ...req.body, buyerName: req.body?.buyerName || 'Guest' });
    reserved = createReservedOrder(input);
    if (reserved.error) return res.status(reserved.statusCode).json({ error: reserved.error });

    if (!paypalConfigured) {
      return res.json({ id: String(reserved.id), demo: true, pickupCode: reserved.pickupCode, order: reserved });
    }

    try {
      const paypalOrder = await createPayPalOrder(reserved);
      db.prepare('UPDATE orders SET paypal_order_id = ? WHERE id = ? AND status = \'created\'').run(paypalOrder.id, reserved.id);
      return res.json({ id: paypalOrder.id, demo: false, pickupCode: reserved.pickupCode, order: reserved });
    } catch (error) {
      releaseOrderStock(reserved.id);
      console.warn('PayPal order creation failed:', error.message);
      return res.status(502).json({ error: 'Payment checkout could not be started. The bundle has been returned to stock.' });
    }
  } catch (error) {
    if (error.name === 'ZodError') return res.status(400).json({ error: error.errors[0]?.message || 'Invalid order.' });
    console.error('Error in /api/orders/create:', error);
    return res.status(500).json({ error: 'Could not initiate order.' });
  }
});

app.post('/api/orders/capture', async (req, res) => {
  try {
    const rawId = req.body?.orderId;
    if (!rawId) return res.status(400).json({ error: 'Order ID is required.' });
    const order = db.prepare(`
      SELECT o.*, l.title AS listing_title, l.pickup_by, l.address
      FROM orders o JOIN listings l ON l.id = o.listing_id
      WHERE o.id = ? OR o.paypal_order_id = ?
    `).get(Number(rawId) || 0, String(rawId));
    if (!order) return res.status(404).json({ error: 'Order not found. Please start checkout again.' });

    if (order.status === 'paid' || order.status === 'picked_up' || (order.status === 'ready' && order.paypal_order_id)) {
      return res.json({ status: 'COMPLETED', demo: !order.paypal_order_id, pickupCode: order.pickup_code, listing: order.listing_title_snapshot || order.listing_title, order: asOrder(order) });
    }
    if (order.status === 'cancelled' || order.status === 'expired') {
      return res.status(409).json({ error: 'This order is no longer active. Please start checkout again.' });
    }
    if (order.paypal_order_id) {
      const captured = await capturePayPalOrder(order.paypal_order_id);
      if (captured.status !== 'COMPLETED') return res.status(402).json({ error: 'PayPal has not completed this payment.' });
      db.prepare("UPDATE orders SET status = 'paid' WHERE id = ? AND status = 'created'").run(order.id);
      const finalOrder = joinedOrder(order.id);
      if (!['paid', 'ready', 'picked_up'].includes(finalOrder.status)) return res.status(409).json({ error: 'Order is no longer active.' });
      return res.json({ status: 'COMPLETED', demo: false, pickupCode: finalOrder.pickup_code, listing: finalOrder.listing_title_snapshot || finalOrder.listing_title, order: asOrder(finalOrder) });
    }
    if (order.status !== 'reserved') return res.status(409).json({ error: 'This demo reservation is no longer active.' });
    return res.json({ status: 'COMPLETED', demo: true, pickupCode: order.pickup_code, listing: order.listing_title_snapshot || order.listing_title, order: asOrder(order) });
  } catch (error) {
    console.error('Error in /api/orders/capture:', error);
    return res.status(502).json({ error: 'Could not complete order checkout.' });
  }
});

app.patch('/api/orders/:id/status', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const { status } = statusSchema.parse(req.body || {});
    const order = db.prepare(`
      SELECT o.*, l.seller_id, l.title AS listing_title
      FROM orders o JOIN listings l ON l.id = o.listing_id WHERE o.id = ?
    `).get(Number(req.params.id));
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (Number(order.seller_id) !== Number(req.session.userId)) return res.status(403).json({ error: 'You can only update orders for your listings.' });

    const transitions = {
      created: ['cancelled'],
      reserved: ['ready', 'cancelled'],
      paid: ['ready'],
      ready: ['picked_up'],
      picked_up: [],
      cancelled: [],
      expired: []
    };
    if (!transitions[order.status]?.includes(status)) {
      return res.status(409).json({ error: `Cannot change an order from ${order.status} to ${status}.` });
    }

    const updated = db.transaction(() => {
      const changed = db.prepare('UPDATE orders SET status = ? WHERE id = ? AND status = ?').run(status, order.id, order.status);
      if (changed.changes !== 1) return null;
      if (status === 'cancelled') db.prepare('UPDATE listings SET quantity = quantity + ? WHERE id = ?').run(order.quantity, order.listing_id);
      return db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    })();
    if (!updated) return res.status(409).json({ error: 'Order status changed. Refresh and try again.' });
    res.json({ order: { id: updated.id, status: updated.status, listingTitle: order.listing_title } });
  } catch (error) {
    if (error.name === 'ZodError') return res.status(400).json({ error: error.errors[0]?.message || 'Invalid order status.' });
    console.error('Could not update order status:', error);
    res.status(500).json({ error: 'Could not update order status.' });
  }
});

app.post('/api/seller/orders/verify', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Authentication required.' });
  const pickupCode = String(req.body?.pickupCode || '').trim().toUpperCase();
  if (!pickupCode) return res.status(400).json({ error: 'Enter a pickup code to verify.' });
  const order = db.prepare(`
    SELECT o.*, l.seller_id, l.title AS listing_title, l.pickup_by, l.address
    FROM orders o JOIN listings l ON l.id = o.listing_id
    WHERE l.seller_id = ? AND UPPER(o.pickup_code) = ?
  `).get(req.session.userId, pickupCode);
  if (!order) return res.status(404).json({ error: `No active order found with pickup code "${pickupCode}" for your shop.` });
  if (!['reserved', 'paid', 'ready'].includes(order.status)) {
    return res.status(409).json({ error: order.status === 'picked_up' ? `Pickup code ${pickupCode} was already collected.` : `Order ${pickupCode} is ${order.status}.` });
  }
  const changed = db.prepare("UPDATE orders SET status = 'picked_up' WHERE id = ? AND status = ?").run(order.id, order.status);
  if (changed.changes !== 1) return res.status(409).json({ error: 'Order status changed. Refresh and try again.' });
  const updated = joinedOrder(order.id);
  res.json({ success: true, message: `Verified! Hand over ${order.quantity} bundle(s) of "${order.listing_title}".`, order: asOrder(updated) });
});

export { app };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`LastPlate running on http://localhost:${port}`));
}
