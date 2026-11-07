import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const dbPath = process.env.DATABASE_PATH || join(root, 'lastplate.db');

try {
  const localEnv = await readFile(join(root, '.env'), 'utf8');
  for (const line of localEnv.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const app = express();
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const port = Number(process.env.PORT || 3000);
const currency = process.env.CURRENCY || 'CAD';
const paypalConfigured = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);

function asJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseTags(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.slice(0, 4).map(String) : [];
  } catch {
    return String(value).split(',').map((part) => part.trim()).filter(Boolean).slice(0, 4);
  }
}

function serializeListing(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    shop: row.shop_name || row.shop || 'Local shop',
    sellerId: row.seller_id ?? row.sellerId ?? null,
    category: row.category || 'Bakery',
    quantity: Number(row.quantity || 0),
    originalValue: Number(row.original_value ?? row.originalValue ?? 0),
    price: Number(row.price || 0),
    pickupBy: row.pickup_by || row.pickupBy || 'Today, 7:00 pm',
    address: row.address || '',
    image: row.image || '🥖',
    tags: parseTags(row.tags),
    ingredients: row.ingredients || 'Ask the shop directly about ingredients and allergens.',
    active: row.status === 'active',
    status: row.status || 'active'
  };
}

function serializeOrder(row) {
  const listingTitle = row.listing_title || row.title || row.listingTitle || null;
  return {
    id: row.id,
    listingId: row.listing_id,
    title: listingTitle,
    listingTitle,
    sellerId: row.seller_id,
    buyerName: row.buyer_name || 'Guest',
    quantity: Number(row.quantity || 0),
    total: Number(row.total || 0),
    status: row.status,
    pickupCode: row.pickup_code,
    pickupBy: row.pickup_by || 'Today, 7:00 pm',
    createdAt: row.created_at
  };
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  next();
}

const signupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(100)
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(100)
});

const listingSchema = z.object({
  title: z.string().trim().min(2).max(100),
  description: z.string().trim().min(10).max(500),
  category: z.string().trim().min(2).max(40).default('Bakery'),
  price: z.coerce.number().min(0.5).max(500),
  originalValue: z.coerce.number().min(0).max(500).default(0),
  quantity: z.coerce.number().int().min(1).max(100),
  pickupBy: z.string().trim().min(3).max(60).default('Today, 7:00 pm'),
  address: z.string().trim().min(3).max(200),
  image: z.string().trim().max(8).default('🥖'),
  tags: z.array(z.string().trim().max(24)).max(4).default([]),
  ingredients: z.string().trim().max(250).default('Ask the shop directly about ingredients and allergens.')
});

const orderSchema = z.object({
  listingId: z.coerce.number().int().min(1),
  quantity: z.coerce.number().int().min(1).max(10),
  buyerName: z.string().trim().max(80).optional().default('Guest')
});

const statusSchema = z.object({
  status: z.enum(['reserved', 'paid', 'picked_up', 'cancelled', 'expired'])
});

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Bakery',
      price REAL NOT NULL,
      original_value REAL DEFAULT 0,
      quantity INTEGER NOT NULL DEFAULT 1,
      pickup_by TEXT NOT NULL,
      address TEXT NOT NULL,
      image TEXT NOT NULL DEFAULT '🥖',
      tags TEXT DEFAULT '[]',
      ingredients TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(seller_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER NOT NULL,
      seller_id INTEGER NOT NULL,
      buyer_name TEXT NOT NULL DEFAULT 'Guest',
      quantity INTEGER NOT NULL,
      total REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'reserved',
      pickup_code TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(listing_id) REFERENCES listings(id),
      FOREIGN KEY(seller_id) REFERENCES users(id)
    );
  `);

  const listingCount = db.prepare('SELECT COUNT(*) AS count FROM listings').get();
  if (!Number(listingCount?.count || 0)) {
    const seller = db.prepare("INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?) ").run(
      'Demo shop',
      'shop@example.com',
      bcrypt.hashSync('password123', 10),
      new Date().toISOString()
    );

    db.prepare(`
      INSERT INTO listings (seller_id, title, description, category, price, original_value, quantity, pickup_by, address, image, tags, ingredients, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(
      seller.lastInsertRowid,
      'The Baker’s Closing Box',
      'A mix of today’s fresh bakery favourites, packed before closing. Great for breakfast tomorrow.',
      'Bakery',
      8,
      18,
      4,
      'Today, 7:00 pm',
      '12 King Street West',
      '🥐',
      JSON.stringify(['Baked today', 'Surprise box']),
      'Wheat, milk, eggs. May contain nuts.',
      new Date().toISOString()
    );
  }
}

initializeDatabase();

app.use(express.json({ limit: '1mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'lastplate-local-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { sameSite: 'lax', httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/api/config', (req, res) => {
  res.json({
    paypalConfigured,
    paypalClientId: paypalConfigured ? process.env.PAYPAL_CLIENT_ID : '',
    currency,
    aiConfigured: Boolean(process.env.OPENAI_API_KEY)
  });
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    const data = signupSchema.parse(req.body || {});
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(data.email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'An account with that email already exists.' });

    const passwordHash = await bcrypt.hash(data.password, 10);
    const result = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
      .run(data.name, data.email.toLowerCase(), passwordHash);

    req.session.userId = Number(result.lastInsertRowid);
    req.session.userName = data.name;

    res.status(201).json({
      user: { id: Number(result.lastInsertRowid), name: data.name, email: data.email.toLowerCase() }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request.' });
    }
    res.status(500).json({ error: 'Could not create account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const data = loginSchema.parse(req.body || {});
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(data.email.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

    const valid = await bcrypt.compare(data.password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password.' });

    req.session.userId = user.id;
    req.session.userName = user.name;

    res.json({
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request.' });
    }
    res.status(500).json({ error: 'Could not log in.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Session expired.' });
  res.json({ user });
});

app.get('/api/listings', (req, res) => {
  const rows = db.prepare(`
    SELECT l.*, u.name AS shop_name
    FROM listings l
    JOIN users u ON u.id = l.seller_id
    WHERE l.status = 'active' AND l.quantity > 0
    ORDER BY l.created_at DESC
  `).all();

  res.json(rows.map((row) => serializeListing(row)));
});

app.get('/api/listings/:id', (req, res) => {
  const row = db.prepare(`
    SELECT l.*, u.name AS shop_name
    FROM listings l
    JOIN users u ON u.id = l.seller_id
    WHERE l.id = ?
  `).get(Number(req.params.id));

  if (!row) return res.status(404).json({ error: 'Listing not found.' });
  res.json({ listing: serializeListing(row) });
});

app.post('/api/listings', requireAuth, (req, res) => {
  try {
    const data = listingSchema.parse(req.body || {});
    const result = db.prepare(`
      INSERT INTO listings (seller_id, title, description, category, price, original_value, quantity, pickup_by, address, image, tags, ingredients, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(
      req.session.userId,
      data.title,
      data.description,
      data.category,
      Number(data.price),
      Number(data.originalValue),
      Number(data.quantity),
      data.pickupBy,
      data.address,
      data.image,
      JSON.stringify(data.tags),
      data.ingredients,
    );

    const row = db.prepare(`
      SELECT l.*, u.name AS shop_name
      FROM listings l
      JOIN users u ON u.id = l.seller_id
      WHERE l.id = ?
    `).get(Number(result.lastInsertRowid));

    res.status(201).json({ listing: serializeListing(row) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid listing.' });
    }
    res.status(500).json({ error: 'Could not create listing.' });
  }
});

app.patch('/api/listings/:id', requireAuth, (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(Number(req.params.id));
  if (!listing) return res.status(404).json({ error: 'Listing not found.' });
  if (listing.seller_id !== Number(req.session.userId)) {
    return res.status(403).json({ error: 'You can only edit your own listings.' });
  }

  const payload = req.body || {};
  const patch = {};

  if (payload.title !== undefined) patch.title = String(payload.title).trim();
  if (payload.description !== undefined) patch.description = String(payload.description).trim();
  if (payload.category !== undefined) patch.category = String(payload.category).trim();
  if (payload.price !== undefined) patch.price = Number(payload.price);
  if (payload.originalValue !== undefined) patch.original_value = Number(payload.originalValue);
  if (payload.quantity !== undefined) patch.quantity = Number(payload.quantity);
  if (payload.pickupBy !== undefined) patch.pickup_by = String(payload.pickupBy).trim();
  if (payload.address !== undefined) patch.address = String(payload.address).trim();
  if (payload.image !== undefined) patch.image = String(payload.image).trim();
  if (payload.tags !== undefined) patch.tags = JSON.stringify(Array.isArray(payload.tags) ? payload.tags.map(String).slice(0, 4) : []);
  if (payload.ingredients !== undefined) patch.ingredients = String(payload.ingredients).trim();
  if (payload.status !== undefined) patch.status = String(payload.status).trim();

  const entries = Object.entries(patch);
  if (!entries.length) return res.status(400).json({ error: 'No valid fields to update.' });

  const setParts = entries.map(([key]) => `${key} = ?`).join(', ');
  const values = entries.map(([, value]) => value);

  db.prepare(`UPDATE listings SET ${setParts} WHERE id = ?`).run(...values, Number(req.params.id));

  const updated = db.prepare(`
    SELECT l.*, u.name AS shop_name
    FROM listings l
    JOIN users u ON u.id = l.seller_id
    WHERE l.id = ?
  `).get(Number(req.params.id));

  res.json({ listing: serializeListing(updated) });
});

app.delete('/api/listings/:id', requireAuth, (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(Number(req.params.id));
  if (!listing) return res.status(404).json({ error: 'Listing not found.' });
  if (listing.seller_id !== Number(req.session.userId)) {
    return res.status(403).json({ error: 'You can only delete your own listings.' });
  }

  db.prepare("UPDATE listings SET status = 'inactive' WHERE id = ?").run(Number(req.params.id));
  res.json({ success: true });
});

app.get('/api/seller/orders', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT o.*, l.title AS listing_title, l.pickup_by, u.name AS shop_name
    FROM orders o
    JOIN listings l ON l.id = o.listing_id
    JOIN users u ON u.id = l.seller_id
    WHERE l.seller_id = ?
    ORDER BY o.created_at DESC
  `).all(req.session.userId);

  res.json({ orders: rows.map((row) => serializeOrder(row)) });
});

app.post('/api/orders', (req, res) => {
  try {
    const data = orderSchema.parse(req.body || {});
    const listing = db.prepare('SELECT * FROM listings WHERE id = ? AND status = ?').get(data.listingId, 'active');
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    if (data.quantity > listing.quantity) return res.status(409).json({ error: 'Not enough stock left for that quantity.' });

    const pickupCode = `LP-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const total = Number(listing.price) * Number(data.quantity);

    const result = db.transaction(() => {
      db.prepare('UPDATE listings SET quantity = quantity - ? WHERE id = ?').run(data.quantity, listing.id);
      const orderResult = db.prepare(`
        INSERT INTO orders (listing_id, seller_id, buyer_name, quantity, total, status, pickup_code)
        VALUES (?, ?, ?, ?, ?, 'reserved', ?)
      `).run(listing.id, listing.seller_id, data.buyerName, data.quantity, total, pickupCode);
      return { id: Number(orderResult.lastInsertRowid), pickupCode, total, listingTitle: listing.title };
    })();

    res.status(201).json({
      order: {
        id: result.id,
        listingId: listing.id,
        buyerName: data.buyerName,
        quantity: data.quantity,
        total: result.total,
        status: 'reserved',
        pickupCode: result.pickupCode,
        pickupBy: listing.pickup_by,
        title: result.listingTitle
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid order.' });
    }
    res.status(500).json({ error: 'Could not create order.' });
  }
});

app.post('/api/orders/create', (req, res) => {
  const body = req.body || {};
  const created = app._router ? false : false;
  const result = db.prepare('SELECT * FROM listings WHERE id = ? AND status = ?').get(Number(body.listingId), 'active');
  if (!result) return res.status(404).json({ error: 'Listing not found.' });
  const qty = Math.max(1, Math.min(10, Number(body.quantity || 1)));
  if (qty > result.quantity) return res.status(409).json({ error: 'That bundle is no longer available in this quantity.' });

  const pickupCode = `LP-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const insert = db.transaction(() => {
    db.prepare('UPDATE listings SET quantity = quantity - ? WHERE id = ?').run(qty, result.id);
    const orderResult = db.prepare(`
      INSERT INTO orders (listing_id, seller_id, buyer_name, quantity, total, status, pickup_code)
      VALUES (?, ?, ?, ?, ?, 'reserved', ?)
    `).run(result.id, result.seller_id, 'Guest', qty, Number(result.price) * qty, pickupCode);
    return Number(orderResult.lastInsertRowid);
  })();

  res.json({ id: String(insert), demo: true });
});

app.post('/api/orders/capture', (req, res) => {
  const orderId = Number(req.body?.orderId);
  const order = db.prepare(`
    SELECT o.*, l.title AS listing_title, l.pickup_by, l.price
    FROM orders o
    JOIN listings l ON l.id = o.listing_id
    WHERE o.id = ?
  `).get(orderId);

  if (!order) return res.status(404).json({ error: 'Order not found. Please start checkout again.' });
  if (order.status === 'picked_up') return res.status(200).json({ status: 'COMPLETED', demo: true, pickupCode: order.pickup_code, listing: order.listing_title });

  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('picked_up', order.id);
  res.json({ status: 'COMPLETED', demo: true, pickupCode: order.pickup_code, listing: order.listing_title });
});

app.patch('/api/orders/:id/status', requireAuth, (req, res) => {
  const order = db.prepare(`
    SELECT o.*, l.seller_id, l.title AS listing_title
    FROM orders o
    JOIN listings l ON l.id = o.listing_id
    WHERE o.id = ?
  `).get(Number(req.params.id));

  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.seller_id !== Number(req.session.userId)) {
    return res.status(403).json({ error: 'You can only update orders for your listings.' });
  }

  const data = statusSchema.parse(req.body || {});
  if (data.status === 'cancelled' && order.status !== 'cancelled') {
    db.prepare('UPDATE listings SET quantity = quantity + ? WHERE id = ?').run(order.quantity, order.listing_id);
  }

  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(data.status, order.id);
  res.json({ order: { id: order.id, status: data.status, listingTitle: order.listing_title } });
});

app.get('/api/seller/listings', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT l.*, u.name AS shop_name
    FROM listings l
    JOIN users u ON u.id = l.seller_id
    WHERE l.seller_id = ?
    ORDER BY l.created_at DESC
  `).all(req.session.userId);

  res.json({ listings: rows.map((row) => serializeListing(row)) });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/ai/config', (req, res) => {
  res.json({ configured: Boolean(process.env.OPENAI_API_KEY) });
});

app.post('/api/ai/draft', (req, res) => {
  const body = req.body || {};
  const items = String(body.items || '').trim();
  if (!items) return res.status(400).json({ error: 'Add the surplus items and shop name first.' });

  const firstItems = items.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean).slice(0, 3);
  res.json({
    title: `Today’s ${String(body.category || 'Bakery').trim() || 'bakery'} box`,
    description: `A small surplus bundle from ${String(body.shop || 'the shop')}, packed with ${firstItems.join(', ') || 'today’s leftovers'}. Prepared today; collection before closing. Please check the listed ingredients and ask the shop about allergens.`,
    suggestedPrice: Number(body.originalValue || 12) * 0.5,
    tags: ['Made today', 'Limited quantity'],
    note: 'Demo draft: connect an OpenAI API key for an AI-generated version.'
  });
});

app.post('/api/ai/recommend', (req, res) => {
  const query = String(req.body?.query || '').trim();
  if (!query) return res.status(400).json({ error: 'Tell LastPlate what you are looking for.' });

  const rows = db.prepare('SELECT * FROM listings WHERE status = ? AND quantity > 0 ORDER BY created_at DESC LIMIT 3').all('active');
  const message = 'Here are a few good matches based on your request and the current menu.';
  res.json({
    message,
    recommendations: rows.map((row) => ({ listingId: row.id, reason: `Good fit for: ${query.slice(0, 80)}` }))
  });
});

app.use(express.static(publicDir));

app.get(/^(?!\/api).+/, (req, res) => {
  res.sendFile(join(publicDir, 'index.html'));
});

app.use((error, req, res, next) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request.' });
  }
  console.error('Unhandled server error:', error);
  res.status(500).json({ error: 'Something went wrong.' });
});

app.listen(port, () => {
  console.log(`LastPlate running on http://localhost:${port}`);
});
