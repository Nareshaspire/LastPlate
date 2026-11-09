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

function getListingPhoto(row) {
  if (row.image_url) return row.image_url;
  const t = (String(row.title || '') + ' ' + String(row.category || '')).toLowerCase();
  if (t.includes('closing box') || t.includes('croissant') || t.includes('favourite')) {
    return 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=720&q=80';
  }
  if (t.includes('sourdough') || t.includes('loaf') || t.includes('loaves') || t.includes('bread')) {
    return 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=720&q=80';
  }
  if (t.includes('salad') || t.includes('bowl') || t.includes('lunch') || t.includes('green') || t.includes('garden')) {
    return 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=720&q=80';
  }
  if (t.includes('cookie') || t.includes('sweet') || t.includes('treat') || t.includes('muffin') || t.includes('bake')) {
    return 'https://images.unsplash.com/photo-1499636136210-6f4ee915583e?auto=format&fit=crop&w=720&q=80';
  }
  if (t.includes('panini') || t.includes('sandwich') || t.includes('ciabatta')) {
    return 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=720&q=80';
  }
  if (t.includes('coffee') || t.includes('espresso') || t.includes('cafe')) {
    return 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=720&q=80';
  }
  return 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=720&q=80';
}

function getListingDistance(row) {
  const addr = String(row.address || '').toLowerCase();
  if (addr.includes('king')) return '0.3 km · 4 min walk';
  if (addr.includes('spadina')) return '0.6 km · 8 min walk';
  if (addr.includes('elm')) return '0.8 km · 11 min walk';
  if (addr.includes('queens quay')) return '1.2 km · 16 min walk';
  return '0.5 km · 7 min walk';
}

function getListingCoords(row) {
  const addr = (String(row.address || '') + ' ' + String(row.shop_name || '') + ' ' + String(row.title || '')).toLowerCase();
  if (addr.includes('king') || addr.includes('morrow')) return { lat: 43.6445, lng: -79.4005 };
  if (addr.includes('spadina') || addr.includes('forno')) return { lat: 43.6492, lng: -79.3978 };
  if (addr.includes('elm') || addr.includes('little moss')) return { lat: 43.6575, lng: -79.3842 };
  if (addr.includes('queens quay') || addr.includes('harbour') || addr.includes('field & ferry')) return { lat: 43.6415, lng: -79.3785 };
  if (addr.includes('kensington') || addr.includes('market')) return { lat: 43.6548, lng: -79.4012 };
  const idNum = Number(row.id) || 1;
  const offsets = [
    { lat: 43.6485, lng: -79.3850 },
    { lat: 43.6510, lng: -79.3920 },
    { lat: 43.6460, lng: -79.4040 },
    { lat: 43.6550, lng: -79.3790 },
    { lat: 43.6430, lng: -79.3890 }
  ];
  return offsets[idNum % offsets.length];
}

function getDietaryTags(row) {
  const text = (String(row.title || '') + ' ' + String(row.description || '') + ' ' + String(row.tags || '') + ' ' + String(row.ingredients || '')).toLowerCase();
  const dietary = [];
  if (text.includes('vegan') || text.includes('plant')) dietary.push('Vegan');
  if (text.includes('veggie') || text.includes('vegetarian') || text.includes('sourdough') || text.includes('croissant') || text.includes('bun') || text.includes('scone') || text.includes('bread') || text.includes('bakery')) {
    dietary.push('Vegetarian');
  }
  if (text.includes('gluten-free') || text.includes('gluten free') || text.includes('oat') || text.includes('flourless')) {
    dietary.push('Gluten-Free');
  }
  if (text.includes('halal') || (!text.includes('pork') && !text.includes('bacon') && !text.includes('gelatin') && !text.includes('wine'))) {
    dietary.push('Halal');
  }
  return [...new Set(dietary)];
}

function getListingSocial(row) {
  const seed = (Number(row.id) || 1) * 7;
  const rating = (4.8 + ((seed % 3) * 0.1)).toFixed(1);
  const reviews = 28 + (seed % 64);
  const co2 = (1.8 + ((seed % 12) * 0.1)).toFixed(1);
  return { rating, reviews, co2: `${co2} kg` };
}

function serializeListing(row) {
  const originalValue = Number(row.original_value ?? row.originalValue ?? 0);
  const price = Number(row.price || 0);
  const discountPercent = (originalValue > price && originalValue > 0)
    ? Math.round(((originalValue - price) / originalValue) * 100)
    : 0;
  const social = getListingSocial(row);
  const coords = getListingCoords(row);
  const dietary = getDietaryTags(row);

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    shop: row.shop_name || row.shop || 'Local shop',
    sellerId: row.seller_id ?? row.sellerId ?? null,
    category: row.category || 'Bakery',
    quantity: Number(row.quantity || 0),
    originalValue,
    price,
    discountPercent,
    pickupBy: row.pickup_by || row.pickupBy || 'Today, 7:00 pm',
    address: row.address || '',
    distance: getListingDistance(row),
    lat: coords.lat,
    lng: coords.lng,
    dietary,
    image: row.image || '🥖',
    imageUrl: getListingPhoto(row),
    rating: social.rating,
    reviews: social.reviews,
    co2Saved: social.co2,
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
    createdAt: row.created_at,
    paypalOrderId: row.paypal_order_id || null
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
  status: z.enum(['created', 'reserved', 'paid', 'picked_up', 'cancelled', 'expired'])
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
      paypal_order_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(listing_id) REFERENCES listings(id),
      FOREIGN KEY(seller_id) REFERENCES users(id)
    );
  `);

  try {
    db.exec('ALTER TABLE orders ADD COLUMN paypal_order_id TEXT');
  } catch {
    // column already exists
  }

  try {
    db.exec('ALTER TABLE listings ADD COLUMN image_url TEXT');
  } catch {
    // column already exists
  }

  const sampleListings = [
    {
      sellerEmail: 'shop@morrowandrye.com',
      sellerName: 'Morrow & Rye',
      title: 'The Baker’s Closing Box',
      description: 'A mix of today’s fresh bakery favourites, packed before closing. Great for breakfast tomorrow.',
      category: 'Bakery',
      price: 8,
      originalValue: 18,
      quantity: 4,
      pickupBy: 'Today, 7:00 pm',
      address: '12 King Street West',
      image: '🥐',
      tags: ['Baked today', 'Surprise box'],
      ingredients: 'Wheat, milk, eggs. May contain nuts.'
    },
    {
      sellerEmail: 'shop@morrowandrye.com',
      sellerName: 'Morrow & Rye',
      title: 'Artisan Sourdough & Country Loaves',
      description: 'Two traditional sourdough country loaves baked this morning. Crusty, chewy, and naturally fermented.',
      category: 'Bakery',
      price: 6,
      originalValue: 14,
      quantity: 3,
      pickupBy: 'Today, 7:00 pm',
      address: '12 King Street West',
      image: '🥖',
      tags: ['Sourdough', 'Vegan friendly', 'Baked today'],
      ingredients: 'Organic unbleached wheat flour, water, natural sourdough starter, sea salt.'
    },
    {
      sellerEmail: 'hello@littlefern.com',
      sellerName: 'Little Fern Kitchen',
      title: 'Garden Lunch & Green Bowl Bundle',
      description: 'Freshly prepared vegetable wraps, a seasonal grain salad, and fresh cold-pressed juice. Keep chilled and enjoy today.',
      category: 'Cafe',
      price: 7.5,
      originalValue: 17,
      quantity: 5,
      pickupBy: 'Today, 6:30 pm',
      address: '84 Spadina Avenue',
      image: '🥗',
      tags: ['Vegetarian', 'Fresh meal', 'Healthy'],
      ingredients: 'Mixed greens, roasted chickpeas, quinoa, avocado, tahini, lemon. Contains sesame.'
    },
    {
      sellerEmail: 'contact@sweethearth.com',
      sellerName: 'Sweet Hearth Bakehouse',
      title: 'Afternoon Sweet Treat Bag',
      description: 'Three assorted artisan cookies and two daily muffins baked this morning. Selection varies daily.',
      category: 'Bakery',
      price: 6,
      originalValue: 14,
      quantity: 4,
      pickupBy: 'Today, 7:30 pm',
      address: '45 Elm Street',
      image: '🍪',
      tags: ['Sweet treats', 'Baked today', 'Cookies'],
      ingredients: 'Wheat flour, butter, dark chocolate, brown sugar, eggs, vanilla. May contain nuts.'
    },
    {
      sellerEmail: 'manager@harbourbrew.ca',
      sellerName: 'Harbour Brew Café',
      title: 'Artisan Panini & Espresso Roast Pairing',
      description: 'Warm grilled vegetable & mozzarella ciabatta panini paired with a bag of today’s freshly roasted coffee beans.',
      category: 'Cafe',
      price: 9,
      originalValue: 20,
      quantity: 3,
      pickupBy: 'Today, 6:00 pm',
      address: '210 Queens Quay West',
      image: '☕',
      tags: ['Warm lunch', 'Gourmet', 'Coffee'],
      ingredients: 'Ciabatta bread, grilled zucchini, bell peppers, mozzarella, basil pesto. Contains dairy and gluten.'
    }
  ];

  for (const item of sampleListings) {
    const existingListing = db.prepare('SELECT id FROM listings WHERE title = ?').get(item.title);
    if (!existingListing) {
      let seller = db.prepare('SELECT id FROM users WHERE email = ?').get(item.sellerEmail);
      if (!seller) {
        const insertUser = db.prepare('INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
          item.sellerName,
          item.sellerEmail,
          bcrypt.hashSync('password123', 10),
          new Date().toISOString()
        );
        seller = { id: insertUser.lastInsertRowid };
      }
      db.prepare(`
        INSERT INTO listings (seller_id, title, description, category, price, original_value, quantity, pickup_by, address, image, tags, ingredients, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
      `).run(
        seller.id,
        item.title,
        item.description,
        item.category,
        item.price,
        item.originalValue,
        item.quantity,
        item.pickupBy,
        item.address,
        item.image,
        JSON.stringify(item.tags),
        item.ingredients,
        new Date().toISOString()
      );
    }
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
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

const rateLimits = new Map();
function createRateLimiter(maxRequests = 20, windowMs = 60000) {
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const client = rateLimits.get(ip) || { count: 0, resetTime: now + windowMs };

    if (now > client.resetTime) {
      client.count = 0;
      client.resetTime = now + windowMs;
    }

    client.count++;
    rateLimits.set(ip, client);

    if (client.count > maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please wait a moment before trying again.' });
    }
    next();
  };
}
const aiLimiter = createRateLimiter(30, 60000);

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

async function createPayPalOrder(listing, quantity) {
  const token = await paypalToken();
  const totalValue = (Number(listing.price) * Number(quantity)).toFixed(2);
  const response = await fetch('https://api-m.sandbox.paypal.com/v2/checkout/orders', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: String(listing.id),
        description: String(listing.title).slice(0, 127),
        amount: { currency_code: currency, value: totalValue },
        custom_id: `${listing.id}:${quantity}`
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

app.get('/api/seller/orders', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT o.*, l.title AS listing_title, l.pickup_by, u.name AS shop_name
    FROM orders o
    JOIN listings l ON l.id = o.listing_id
    JOIN users u ON u.id = l.seller_id
    WHERE l.seller_id = ? AND o.status != 'created'
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

app.post('/api/orders/create', async (req, res) => {
  try {
    const body = req.body || {};
    const listingId = Number(body.listingId);
    const qty = Math.max(1, Math.min(10, Number(body.quantity || 1)));

    const listing = db.prepare('SELECT * FROM listings WHERE id = ? AND status = ?').get(listingId, 'active');
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    if (qty > listing.quantity) {
      return res.status(409).json({ error: 'That bundle is no longer available in this quantity.' });
    }

    const pickupCode = `LP-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const total = Number(listing.price) * qty;

    if (!paypalConfigured) {
      const insert = db.transaction(() => {
        db.prepare('UPDATE listings SET quantity = quantity - ? WHERE id = ?').run(qty, listing.id);
        const orderResult = db.prepare(`
          INSERT INTO orders (listing_id, seller_id, buyer_name, quantity, total, status, pickup_code)
          VALUES (?, ?, 'Guest', ?, ?, 'reserved', ?)
        `).run(listing.id, listing.seller_id, qty, total, pickupCode);
        return Number(orderResult.lastInsertRowid);
      })();

      return res.json({ id: String(insert), demo: true, pickupCode });
    }

    let paypalOrder;
    try {
      paypalOrder = await createPayPalOrder(listing, qty);
    } catch (payPalErr) {
      console.warn('PayPal unavailable, falling back to local demo order:', payPalErr.message);
      const insert = db.transaction(() => {
        db.prepare('UPDATE listings SET quantity = quantity - ? WHERE id = ?').run(qty, listing.id);
        const orderResult = db.prepare(`
          INSERT INTO orders (listing_id, seller_id, buyer_name, quantity, total, status, pickup_code)
          VALUES (?, ?, 'Guest', ?, ?, 'reserved', ?)
        `).run(listing.id, listing.seller_id, qty, total, pickupCode);
        return Number(orderResult.lastInsertRowid);
      })();

      return res.json({ id: String(insert), demo: true, pickupCode });
    }

    db.prepare(`
      INSERT INTO orders (listing_id, seller_id, buyer_name, quantity, total, status, pickup_code, paypal_order_id)
      VALUES (?, ?, 'Guest', ?, ?, 'created', ?, ?)
    `).run(listing.id, listing.seller_id, qty, total, pickupCode, paypalOrder.id);

    res.json({ id: paypalOrder.id, demo: false, pickupCode });
  } catch (error) {
    console.error('Error in /api/orders/create:', error);
    res.status(500).json({ error: error.message || 'Could not initiate order.' });
  }
});

app.post('/api/orders/capture', async (req, res) => {
  try {
    const rawOrderId = req.body?.orderId;
    if (!rawOrderId) return res.status(400).json({ error: 'Order ID is required.' });

    const order = db.prepare(`
      SELECT o.*, l.title AS listing_title, l.pickup_by, l.price, l.quantity AS current_stock
      FROM orders o
      JOIN listings l ON l.id = o.listing_id
      WHERE o.id = ? OR o.paypal_order_id = ?
    `).get(Number(rawOrderId) || 0, String(rawOrderId));

    if (!order) {
      return res.status(404).json({ error: 'Order not found. Please start checkout again.' });
    }

    if (order.status === 'paid' || order.status === 'picked_up') {
      return res.status(200).json({
        status: 'COMPLETED',
        demo: !order.paypal_order_id,
        pickupCode: order.pickup_code,
        listing: order.listing_title
      });
    }

    if (order.paypal_order_id) {
      if (order.current_stock < order.quantity) {
        return res.status(409).json({ error: 'Bundle quantity changed before payment. Please choose another bundle.' });
      }

      const captured = await capturePayPalOrder(order.paypal_order_id);
      if (captured.status !== 'COMPLETED') {
        return res.status(402).json({ error: 'PayPal has not completed this payment.' });
      }

      db.transaction(() => {
        db.prepare('UPDATE listings SET quantity = quantity - ? WHERE id = ?').run(order.quantity, order.listing_id);
        db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('paid', order.id);
      })();

      return res.json({
        status: 'COMPLETED',
        demo: false,
        pickupCode: order.pickup_code,
        listing: order.listing_title
      });
    }

    // Demo reservation completion
    res.json({
      status: 'COMPLETED',
      demo: true,
      pickupCode: order.pickup_code,
      listing: order.listing_title
    });
  } catch (error) {
    console.error('Error in /api/orders/capture:', error);
    res.status(500).json({ error: error.message || 'Could not complete order checkout.' });
  }
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

app.post('/api/seller/orders/verify', requireAuth, (req, res) => {
  const rawCode = String(req.body?.pickupCode || '').trim().toUpperCase();
  if (!rawCode) return res.status(400).json({ error: 'Enter a pickup code to verify.' });

  const order = db.prepare(`
    SELECT o.*, l.title AS listing_title, l.pickup_by, u.name AS shop_name
    FROM orders o
    JOIN listings l ON l.id = o.listing_id
    JOIN users u ON u.id = l.seller_id
    WHERE l.seller_id = ? AND UPPER(o.pickup_code) = ?
  `).get(req.session.userId, rawCode);

  if (!order) {
    return res.status(404).json({ error: `No active order found with pickup code "${rawCode}" for your shop.` });
  }

  if (order.status === 'picked_up') {
    return res.status(400).json({ error: `Pickup code ${rawCode} was already collected.` });
  }

  if (order.status === 'cancelled') {
    return res.status(400).json({ error: `Order ${rawCode} was cancelled.` });
  }

  db.prepare("UPDATE orders SET status = 'picked_up' WHERE id = ?").run(order.id);

  const updated = db.prepare(`
    SELECT o.*, l.title AS listing_title, l.pickup_by, u.name AS shop_name
    FROM orders o
    JOIN listings l ON l.id = o.listing_id
    JOIN users u ON u.id = l.seller_id
    WHERE o.id = ?
  `).get(order.id);

  res.json({
    success: true,
    message: `Verified! Hand over ${order.quantity} bundle(s) of "${order.listing_title}".`,
    order: serializeOrder(updated)
  });
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

async function draftBundle(body) {
  const items = String(body.items || '').trim().slice(0, 2000);
  const shop = String(body.shop || '').trim().slice(0, 100);
  const category = String(body.category || 'Bakery').trim().slice(0, 60);
  if (!items || !shop) throw new Error('Add the surplus items and shop name first.');

  const fallbackPrice = Math.max(0.5, Number(body.originalValue || 12) * 0.5);
  const firstItems = items.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean).slice(0, 3);
  const fallbackDraft = {
    title: `Today’s ${category.toLowerCase()} box`,
    description: `A small surplus bundle from ${shop}, packed with ${firstItems.join(', ') || 'today’s leftovers'}. Prepared today; collection before closing. Please check the listed ingredient details.`,
    suggestedPrice: fallbackPrice,
    tags: ['Made today', 'Limited quantity'],
    note: process.env.OPENAI_API_KEY
      ? 'Review the draft and set your price before publishing.'
      : 'Demo draft: connect an OpenAI API key for an AI-generated version.'
  };

  if (!process.env.OPENAI_API_KEY) {
    return fallbackDraft;
  }

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      suggestedPrice: { type: 'number' },
      tags: { type: 'array', items: { type: 'string' } }
    },
    required: ['title', 'description', 'suggestedPrice', 'tags']
  };

  const instructions = 'You write concise, honest surplus food listings for a same-day local marketplace. Use only seller-provided facts. Never invent ingredients, allergens, quality, freshness, or availability.';
  const promptInput = JSON.stringify({
    shop,
    category,
    items,
    originalValue: Number(body.originalValue || 0),
    sellerNotes: String(body.notes || '').slice(0, 1000),
    ingredients: String(body.ingredients || '').slice(0, 1000)
  });

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-6-astra',
        instructions,
        input: promptInput,
        text: { format: { type: 'json_schema', name: 'lastplate_listing', strict: true, schema } }
      })
    });

    if (response.ok) {
      const data = await response.json();
      const text = data.output_text || data.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text;
      if (text) {
        return { ...JSON.parse(text), note: 'AI draft. Review every detail and approve it before publishing.' };
      }
    }

    const chatResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: instructions },
          { role: 'user', content: promptInput }
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'lastplate_listing', strict: true, schema } }
      })
    });

    if (chatResponse.ok) {
      const chatData = await chatResponse.json();
      const text = chatData.choices?.[0]?.message?.content;
      if (text) {
        return { ...JSON.parse(text), note: 'AI draft. Review every detail and approve it before publishing.' };
      }
    }

    return fallbackDraft;
  } catch (err) {
    console.warn('OpenAI draft generation failed:', err.message);
    return fallbackDraft;
  }
}

async function recommendBundles(query) {
  const cleanedQuery = String(query || '').trim().slice(0, 500);
  if (!cleanedQuery) throw new Error('Tell LastPlate what you are looking for.');

  if (/allerg|anaphyl|celiac|coeliac/i.test(cleanedQuery)) {
    throw new Error('For allergy or medical dietary needs, review the shop’s ingredient details and contact the shop directly. LastPlate’s AI cannot verify food safety.');
  }

  const rows = db.prepare(`
    SELECT l.*, u.name AS shop_name
    FROM listings l
    JOIN users u ON u.id = l.seller_id
    WHERE l.status = 'active' AND l.quantity > 0
    ORDER BY l.created_at DESC
  `).all();

  if (!rows.length) {
    return {
      message: 'No surplus bundles are currently available on the menu. Check back soon!',
      recommendations: []
    };
  }

  const catalog = rows.map((r) => ({
    id: String(r.id),
    title: r.title,
    description: r.description,
    shop: r.shop_name,
    category: r.category,
    price: Number(r.price),
    pickupBy: r.pickup_by,
    address: r.address,
    tags: parseTags(r.tags),
    quantity: Number(r.quantity)
  }));

  const fallbackRecommendations = catalog.slice(0, 3).map((item) => ({
    listingId: Number(item.id),
    reason: `Good fit for: ${cleanedQuery.slice(0, 80)}`
  }));

  if (!process.env.OPENAI_API_KEY) {
    return {
      message: 'Here are a few good matches based on your request and the current menu.',
      recommendations: fallbackRecommendations
    };
  }

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      message: { type: 'string' },
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { listingId: { type: 'string' }, reason: { type: 'string' } },
          required: ['listingId', 'reason']
        }
      }
    },
    required: ['message', 'recommendations']
  };

  const instructions = 'You are LastPlate, a concise local surplus-food discovery assistant. Match the shopper request to at most three available bundles in the supplied catalog. Recommend only items that exist in the catalog.';
  const promptInput = JSON.stringify({ shopperRequest: cleanedQuery, availableBundles: catalog });

  try {
    let result = null;

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-6-astra',
        instructions,
        input: promptInput,
        text: { format: { type: 'json_schema', name: 'lastplate_recommendations', strict: true, schema } }
      })
    });

    if (response.ok) {
      const data = await response.json();
      const text = data.output_text || data.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text;
      if (text) result = JSON.parse(text);
    } else {
      const chatResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: instructions },
            { role: 'user', content: promptInput }
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'lastplate_recommendations', strict: true, schema } }
        })
      });

      if (chatResponse.ok) {
        const chatData = await chatResponse.json();
        const text = chatData.choices?.[0]?.message?.content;
        if (text) result = JSON.parse(text);
      }
    }

    if (!result) {
      return {
        message: 'Here are a few good matches based on your request and the current menu.',
        recommendations: fallbackRecommendations
      };
    }

    const allowed = new Map(catalog.map((item) => [String(item.id), item]));
    const recommendations = (result.recommendations || [])
      .filter((item) => allowed.has(String(item.listingId)))
      .slice(0, 3)
      .map(({ listingId, reason }) => ({
        listingId: Number(listingId),
        reason: String(reason).slice(0, 220)
      }));

    return {
      message: String(result.message || 'Here are a few matches for your request.').slice(0, 300),
      recommendations
    };
  } catch (err) {
    console.warn('OpenAI recommendation failed, falling back to local matches:', err.message);
    return {
      message: 'Here are a few good matches based on your request and the current menu.',
      recommendations: fallbackRecommendations
    };
  }
}

app.post('/api/ai/draft', aiLimiter, async (req, res) => {
  try {
    const draft = await draftBundle(req.body || {});
    res.json(draft);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not generate draft.' });
  }
});

app.post('/api/ai/recommend', aiLimiter, async (req, res) => {
  try {
    const result = await recommendBundles(req.body?.query);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not recommend bundles.' });
  }
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

export { app };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(port, () => {
    console.log(`LastPlate running on http://localhost:${port}`);
  });
}
