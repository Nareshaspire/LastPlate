# LastPlate 🌿 — Production Deployment Guide

LastPlate is container-ready, zero-build (pure Node.js + vanilla frontend), and can be deployed in minutes on any modern cloud hosting provider.

---

## 🚀 Option 1: Render.com (Recommended — 100% Free & Automatic SSL)

Render provides a completely free tier with automated GitHub CI/CD, SSL certificates, and custom domains.

### Step 1: Push your code to GitHub
Make sure your latest code is pushed to your GitHub repository:
```bash
git add .
git commit -m "feat: complete LastPlate with luxury UI, PWA passbook, tests, and deployment configs"
git push origin main
```

### Step 2: Deploy on Render
1. Visit [dashboard.render.com](https://dashboard.render.com/) and sign in with GitHub.
2. Click **New +** > **Web Service**.
3. Choose **Build and deploy from a Git repository** and pick `LastPlate` (or `Nareshaspire/LastPlate`).
4. Render will auto-detect settings, or you can configure:
   - **Name:** `lastplate`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** `Free`
5. Click **Advanced** > **Add Environment Variable**:
   - `NODE_ENV`: `production`
   - `CURRENCY`: `CAD` (or `USD`)
   - `OPENAI_API_KEY`: *(Optional — for smart food matching & seller AI)*
   - `OPENAI_MODEL`: `gpt-4o-mini`
   - `PAYPAL_CLIENT_ID`: *(Optional — for live PayPal checkout; fallback demo mode works automatically without it)*
   - `PAYPAL_CLIENT_SECRET`: *(Optional)*
6. Click **Create Web Service**. Your app will build, seed the initial database, and be live with an `https://lastplate-xxxx.onrender.com` URL in about 2 minutes!

---

## 🚂 Option 2: Railway.app (Persistent SQLite Storage)

Railway is great for SQLite applications because it supports persistent disk volumes.

1. Sign up at [railway.app](https://railway.app/).
2. Click **New Project** > **Deploy from GitHub repo** > Select `Nareshaspire/LastPlate`.
3. Railway will build using the `Dockerfile` or native Node buildpack automatically.
4. Under **Variables**, add:
   - `NODE_ENV` = `production`
   - `PORT` = `3000`
5. Under **Settings** > **Networking**, click **Generate Domain** to get a free `up.railway.app` HTTPS address.
6. *(Optional)* Add a **Volume** mounted at `/app` if you want persistent disk storage across restarts.

---

## ✈️ Option 3: Fly.io (Docker Multi-Stage Build)

Deploy LastPlate globally using our production multi-stage [`Dockerfile`](file:///home/naresh/Desktop/LastPlate/Dockerfile):

1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Authenticate: `fly auth login`
3. Launch:
   ```bash
   fly launch --name lastplate
   ```
4. Set secrets:
   ```bash
   fly secrets set OPENAI_API_KEY="your-key-here"
   ```
5. Deploy:
   ```bash
   fly deploy
   ```

---

## 🛠️ Verification Checklist After Deploying

- [ ] Open the live URL on desktop and mobile.
- [ ] Test the **Map View** toggle and verify Leaflet markers load.
- [ ] Search for "vegan" or "pastry" to test local AI/search fallbacks.
- [ ] Click **Reserve** on a meal and verify you get an instant 4-digit pickup pass.
- [ ] Visit **My Pickups** and test the **Add to Phone Pass** (PWA offline pass).
- [ ] Visit the **Seller Dashboard** and test listing creation or AI draft assistant.
