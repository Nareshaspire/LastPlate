const state = { listings: [], filter: 'All', config: null, selected: null, quantity: 1, paypalLoaded: false, recommendations: [] };
const grid = document.querySelector('#listing-grid');
const overlay = document.querySelector('#overlay');
const drawerContent = document.querySelector('#drawer-content');
const toast = document.querySelector('#toast');
let toastTimer;

const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = (amount) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: state.config?.currency || 'USD', maximumFractionDigits: 0 }).format(Number(amount || 0));

async function api(path, body, method = body ? 'POST' : 'GET') {
  const options = { method };
  if (body !== undefined) {
    options.headers = { 'content-type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function renderListings() {
  const filtered = state.listings.filter((listing) => state.filter === 'All' || listing.category.toLowerCase() === state.filter.toLowerCase());
  const matches = new Map(state.recommendations.map((item) => [item.listingId, item.reason]));
  const visible = state.recommendations.length
    ? state.recommendations.map((item) => state.listings.find((listing) => listing.id === item.listingId)).filter(Boolean)
    : filtered;
  document.querySelector('#count-all').textContent = state.listings.length;
  document.querySelector('#empty-state').classList.toggle('hidden', visible.length > 0);
  grid.innerHTML = visible.map((listing) => {
    const categoryClass = listing.category.toLowerCase() === 'bakery' ? 'bakery' : listing.category.toLowerCase() === 'cafe' ? 'cafe' : 'other';
    return `<article class="listing-card" data-id="${escapeHTML(listing.id)}" tabindex="0" role="button" aria-label="View ${escapeHTML(listing.title)}">
      <div class="card-art ${categoryClass}"><span class="category-tag">${escapeHTML(listing.category.toUpperCase())}</span><span class="save-tag" aria-hidden="true">♡</span><span class="card-emoji" aria-hidden="true">${escapeHTML(listing.image)}</span></div>
      <div class="card-body"><p class="card-shop">${escapeHTML(listing.shop)}</p><div class="card-title-row"><h3 class="card-title">${escapeHTML(listing.title)}</h3><div class="price"><strong>${money(listing.price)}</strong><del>${money(listing.originalValue)}</del></div></div>
      <p class="card-description">${escapeHTML(listing.description)}</p>${matches.has(listing.id) ? `<div class="ai-match-reason"><span>✳</span> ${escapeHTML(matches.get(listing.id))}</div>` : ''}<div class="card-meta"><span class="pickup-time"><span>◷</span> ${escapeHTML(listing.pickupBy)}</span><span class="stock">${listing.quantity} left</span></div></div></article>`;
  }).join('');
  grid.querySelectorAll('.listing-card').forEach((card) => {
    const open = () => openListing(card.dataset.id);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  });
}

function openDrawer() {
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  document.querySelector('#close-drawer').focus();
}

function closeDrawer() {
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  state.selected = null;
}

function openListing(id) {
  const listing = state.listings.find((item) => String(item.id) === String(id));
  if (!listing) return;
  state.selected = listing;
  state.quantity = 1;
  const tags = (listing.tags || []).map((tag) => `<span>${escapeHTML(tag)}</span>`).join('');
  const isDemo = !state.config?.paypalConfigured;
  const checkout = isDemo
    ? `<div class="checkout-wrap"><button class="demo-checkout" id="demo-checkout">Reserve for pickup</button><p class="demo-note"><span class="demo-badge">Demo only</span> No payment is taken in demo mode.</p></div>`
    : `<div class="checkout-wrap"><div id="paypal-buttons" class="paypal-area"></div><p class="demo-note">PayPal sandbox · no real money</p></div>`;
  drawerContent.innerHTML = `<div class="drawer-art"><span>${escapeHTML(listing.image)}</span></div>
    <p class="drawer-shop">A little extra from <b>${escapeHTML(listing.shop)}</b></p><h2 class="drawer-title" id="drawer-title">${escapeHTML(listing.title)}</h2><p class="drawer-desc">${escapeHTML(listing.description)}</p>
    <div class="drawer-tags">${tags}</div>
    <div class="detail-box"><div class="detail-line"><span>Pick up by</span><b>${escapeHTML(listing.pickupBy)}</b></div><div class="detail-line"><span>Where to find us</span><b>${escapeHTML(listing.address || 'See shop for location')}</b></div><div class="detail-line"><span>Availability</span><b>${listing.quantity} bundle${listing.quantity === 1 ? '' : 's'} left</b></div></div>
    <div class="allergen-note"><b>Ingredients & allergens from the shop</b><br>${escapeHTML(listing.ingredients || 'Ask the shop directly about ingredients and allergens.')}</div>
    <div class="buy-row"><div class="buy-price" id="buy-price">${money(listing.price)} <small>/ bundle</small></div><div class="quantity"><button id="quantity-minus" aria-label="Remove one">−</button><span id="quantity-count">1</span><button id="quantity-plus" aria-label="Add one">+</button></div></div>
    ${checkout}`;
  openDrawer();
  const updateQuantity = (next) => {
    state.quantity = Math.max(1, Math.min(listing.quantity, next));
    document.querySelector('#quantity-count').textContent = state.quantity;
    document.querySelector('#buy-price').innerHTML = `${money(listing.price * state.quantity)} <small>/ ${state.quantity} bundle${state.quantity === 1 ? '' : 's'}</small>`;
  };
  document.querySelector('#quantity-minus').addEventListener('click', () => updateQuantity(state.quantity - 1));
  document.querySelector('#quantity-plus').addEventListener('click', () => updateQuantity(state.quantity + 1));
  if (isDemo) document.querySelector('#demo-checkout').addEventListener('click', () => demoPurchase(listing));
  else mountPaypal(listing);
}

async function demoPurchase(listing) {
  const button = document.querySelector('#demo-checkout');
  button.disabled = true; button.textContent = 'Saving your pickup…';
  try {
    const order = await api('/api/orders/create', { listingId: listing.id, quantity: state.quantity });
    const result = await api('/api/orders/capture', { orderId: order.id });
    showSuccess(result, true);
  } catch (error) { notify(error.message); button.disabled = false; button.textContent = 'Reserve for pickup'; }
}

async function showSuccess(result, demo) {
  drawerContent.innerHTML = `<div class="pickup-success"><div class="success-icon">✓</div><span class="demo-badge">${demo ? 'Demo reservation' : 'Sandbox payment complete'}</span><h2>You saved a little something.</h2><p>${demo ? 'Your demo pickup has been reserved.' : 'Your PayPal sandbox payment is complete.'} Show this code at the shop before closing to collect your ${escapeHTML(result.listing || state.selected?.title || 'bundle')}.</p><div class="pickup-code">YOUR PICKUP CODE<strong>${escapeHTML(result.pickupCode || 'SAVED')}</strong></div><button class="button button-dark" id="done-button" style="width:100%;justify-content:center">Lovely, thanks <span>✓</span></button></div>`;
  document.querySelector('#done-button').addEventListener('click', async () => { closeDrawer(); await refreshListings(); });
}

async function mountPaypal(listing) {
  const mount = () => {
    if (!window.paypal || !document.querySelector('#paypal-buttons')) return;
    window.paypal.Buttons({
      style: { layout: 'vertical', shape: 'rect', label: 'paypal', height: 42 },
      createOrder: async () => (await api('/api/orders/create', { listingId: listing.id, quantity: state.quantity })).id,
      onApprove: async (data) => {
        try { const result = await api('/api/orders/capture', { orderId: data.orderID }); showSuccess(result, false); }
        catch (error) { notify(error.message); }
      },
      onError: (error) => notify(error.message || 'PayPal checkout could not complete.')
    }).render('#paypal-buttons');
  };
  if (window.paypal) return mount();
  if (state.paypalLoaded) return;
  state.paypalLoaded = true;
  const script = document.createElement('script');
  script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(state.config.paypalClientId)}&currency=${encodeURIComponent(state.config.currency)}&intent=capture`;
  script.onload = mount;
  script.onerror = () => notify('Could not load PayPal sandbox checkout.');
  document.head.append(script);
}

function openListingForm(user) {
  state.selected = null;
  drawerContent.innerHTML = `<div class="seller-head"><div class="eyebrow"><span class="eyebrow-dot"></span> FOR LOCAL SHOPS</div><h2 id="drawer-title">Make a little extra<br>go a little further.</h2><p>Tell us what’s left today. Your listing stays a draft until you’ve reviewed and published it.</p></div>
    <form id="seller-form">
      <label class="form-label" for="shop-name">Shop name</label><input class="form-control" id="shop-name" name="shop" required value="${escapeHTML(user?.name || 'Morrow & Rye')}" readonly>
      <div class="form-grid"><div><label class="form-label" for="category">Shop type</label><select class="form-control" id="category" name="category"><option>Bakery</option><option>Cafe</option><option>Other</option></select></div><div><label class="form-label" for="item-count">Bundles available</label><input class="form-control" id="item-count" name="quantity" type="number" min="1" max="100" value="4" required></div></div>
      <label class="form-label" for="items">What’s in the surplus?</label><textarea class="form-control" id="items" name="items" rows="3" placeholder="e.g. 2 croissants, 1 sourdough loaf, 3 morning buns" required></textarea><p class="form-help">The writing assistant only uses details you provide.</p>
      <div class="form-grid"><div><label class="form-label" for="original-value">Usual value per bundle</label><input class="form-control" id="original-value" name="originalValue" type="number" min="1" step="0.5" value="16" required></div><div><label class="form-label" for="price">Your price</label><input class="form-control" id="price" name="price" type="number" min="0.5" step="0.5" placeholder="Set after draft" required></div></div>
      <div class="form-grid"><div><label class="form-label" for="pickup-by">Pick up by</label><input class="form-control" id="pickup-by" name="pickupBy" value="Today, 7:00 pm" required></div><div><label class="form-label" for="address">Shop address</label><input class="form-control" id="address" name="address" placeholder="Street and number" required></div></div>
      <label class="form-label" for="ingredients">Ingredients & allergen information</label><textarea class="form-control" id="ingredients" name="ingredients" rows="2" placeholder="Only include information verified by your shop"></textarea><p class="form-help">LastPlate will not infer allergens. Keep this accurate and check with your team.</p>
      <label class="form-label" for="notes">Other seller notes</label><input class="form-control" id="notes" name="notes" placeholder="e.g. packed in a paper bag">
      <div class="seller-actions"><button class="button button-outline" id="draft-button" type="button">✦ Draft with AI</button><button class="button button-dark" id="publish-button" type="submit">Publish find <span>↗</span></button></div>
      <div class="ai-status"><span class="ai-stars">✳</span><span id="ai-status-text">AI makes a first draft; you stay in control.</span></div><div id="seller-preview"></div>
    </form>`;
  openDrawer();
  if (!state.config?.aiConfigured) document.querySelector('#ai-status-text').textContent = 'Demo writing helper; add an API key for generated drafts.';
  const form = document.querySelector('#seller-form');
  const draftButton = document.querySelector('#draft-button');
  const priceInput = document.querySelector('#price');
  draftButton.addEventListener('click', async () => {
    const values = Object.fromEntries(new FormData(form).entries());
    if (!values.items || !values.shop) return notify('Add the shop name and surplus items first.');
    draftButton.disabled = true; draftButton.textContent = '✦ Writing your draft…';
    try {
      const draft = await api('/api/ai/draft', values);
      form.dataset.title = draft.title;
      form.dataset.description = draft.description;
      if (!priceInput.value) priceInput.value = Number(draft.suggestedPrice || 0).toFixed(2);
      else priceInput.value = Number(draft.suggestedPrice || priceInput.value).toFixed(2);
      document.querySelector('#ai-status-text').textContent = draft.note || 'Review the listing and set your price before publishing.';
      document.querySelector('#seller-preview').innerHTML = `<div class="seller-preview"><b>Review and edit your AI draft · suggested ${money(draft.suggestedPrice)}</b><label class="form-label" for="draft-title">Listing title</label><input class="form-control" id="draft-title" maxlength="100" value="${escapeHTML(draft.title)}" required><label class="form-label" for="draft-description">Listing description</label><textarea class="form-control" id="draft-description" maxlength="500" rows="4" required>${escapeHTML(draft.description)}</textarea><div style="margin-top:6px;color:#88917f">Suggested tags: ${(draft.tags || []).map(escapeHTML).join(' · ')}</div></div>`;
      form.dataset.tags = JSON.stringify(draft.tags || []);
      notify('Draft ready. Review it, then publish when it looks right.');
    } catch (error) { notify(error.message); }
    finally { draftButton.disabled = false; draftButton.innerHTML = '✦ Draft with AI'; }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const approvedTitle = document.querySelector('#draft-title')?.value.trim();
    const approvedDescription = document.querySelector('#draft-description')?.value.trim();
    if (!approvedTitle || !approvedDescription) return notify('Draft the listing first so you can review it before publishing.');
    const values = Object.fromEntries(new FormData(form).entries());
    const button = document.querySelector('#publish-button'); button.disabled = true; button.textContent = 'Publishing…';
    try {
      const result = await api('/api/listings', { ...values, title: approvedTitle, description: approvedDescription, image: values.category === 'Bakery' ? '🥐' : values.category === 'Cafe' ? '🥗' : '🍽️', tags: JSON.parse(form.dataset.tags || '[]') });
      await refreshListings(); await renderSellerDashboard(user); notify('Your surplus is on the menu.');
    } catch (error) { notify(error.message); button.disabled = false; button.innerHTML = 'Publish find <span>↗</span>'; }
  });
}

function showSellerAuth(mode = 'login') {
  const isSignup = mode === 'signup';
  drawerContent.innerHTML = `<section class="seller-auth"><div class="eyebrow"><span class="eyebrow-dot"></span> FOR LOCAL SHOPS</div><h2>${isSignup ? 'Create your shop account' : 'Welcome back'}</h2><p>${isSignup ? 'Set up an account to publish and manage your surplus listings.' : 'Sign in to manage listings and pickup orders.'}</p>
    <form id="seller-auth-form">
      ${isSignup ? '<label class="form-label" for="seller-name">Shop name</label><input class="form-control" id="seller-name" name="name" maxlength="120" autocomplete="organization" required>' : ''}
      <label class="form-label" for="seller-email">Email</label><input class="form-control" id="seller-email" name="email" type="email" autocomplete="email" required>
      <label class="form-label" for="seller-password">Password</label><input class="form-control" id="seller-password" name="password" type="password" minlength="8" maxlength="100" autocomplete="${isSignup ? 'new-password' : 'current-password'}" required>
      <button class="button button-dark" type="submit" style="width:100%;justify-content:center;margin-top:18px">${isSignup ? 'Create account' : 'Sign in'} <span>↗</span></button>
    </form>
    <p class="seller-auth-switch">${isSignup ? 'Already have a shop account?' : 'New to LastPlate?'} <button id="seller-auth-toggle" type="button">${isSignup ? 'Sign in' : 'Create an account'}</button></p></section>`;
  openDrawer();
  document.querySelector('#seller-auth-toggle').addEventListener('click', () => showSellerAuth(isSignup ? 'login' : 'signup'));
  document.querySelector('#seller-auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const user = await api(`/api/auth/${isSignup ? 'signup' : 'login'}`, Object.fromEntries(new FormData(form).entries()));
      await renderSellerDashboard(user.user);
    } catch (error) {
      notify(error.message);
      submit.disabled = false;
    }
  });
}

async function openSeller() {
  try {
    const { user } = await api('/api/auth/me');
    await renderSellerDashboard(user);
  } catch (error) {
    if (error.message !== 'Authentication required.') return notify(error.message);
    showSellerAuth('login');
  }
}

async function renderSellerDashboard(user) {
  try {
    const [listingResult, orderResult] = await Promise.all([
      api('/api/seller/listings'),
      api('/api/seller/orders')
    ]);
    const listings = listingResult.listings || [];
    const orders = orderResult.orders || [];
    const activeCount = listings.filter((listing) => listing.status === 'active').length;
    const pendingCount = orders.filter((order) => order.status === 'reserved' || order.status === 'paid').length;
    drawerContent.innerHTML = `<section class="seller-dashboard">
      <div class="seller-dashboard-head"><div><div class="eyebrow"><span class="eyebrow-dot"></span> SHOP DASHBOARD</div><h2>${escapeHTML(user?.name || 'Your shop')}</h2><p>${activeCount} active listing${activeCount === 1 ? '' : 's'} · ${pendingCount} pickup${pendingCount === 1 ? '' : 's'} to prepare</p></div>
        <div class="seller-dashboard-actions"><button id="dashboard-add-listing" type="button">＋ Add listing</button><button id="seller-logout" type="button">Sign out</button></div>
      </div>
      <section class="seller-dashboard-section"><h3>Your listings</h3><div class="seller-dashboard-list">${listings.length ? listings.map((listing) => `<article class="seller-dashboard-item"><div><h4>${escapeHTML(listing.title)}</h4><p>${money(listing.price)} · ${listing.quantity} left · ${escapeHTML(listing.status)}</p></div><div class="seller-item-actions">${listing.status === 'active' ? `<button type="button" data-listing-deactivate="${listing.id}">Pause listing</button>` : `<button type="button" data-listing-activate="${listing.id}">Reactivate</button>`}</div></article>`).join('') : '<p class="seller-empty">No listings yet. Add your first surplus bundle.</p>'}</div></section>
      <section class="seller-dashboard-section"><h3>Pickup orders</h3><div class="seller-dashboard-list">${orders.length ? orders.map((order) => `<article class="seller-dashboard-item"><div><h4>${escapeHTML(order.title || order.listingTitle || 'Bundle')} · ${order.quantity} bundle${order.quantity === 1 ? '' : 's'}</h4><p>${escapeHTML(order.buyerName)} · ${money(order.total)} · ${escapeHTML(order.status)} · Pickup code <span class="seller-order-code">${escapeHTML(order.pickupCode)}</span></p></div><div class="seller-order-actions">${order.status === 'reserved' || order.status === 'paid' ? `<button type="button" data-order-picked-up="${order.id}">Mark picked up</button><button type="button" data-order-cancel="${order.id}">Cancel</button>` : ''}</div></article>`).join('') : '<p class="seller-empty">No pickup orders yet.</p>'}</div></section>
    </section>`;
    openDrawer();
    document.querySelector('#dashboard-add-listing').addEventListener('click', () => openListingForm(user));
    document.querySelector('#seller-logout').addEventListener('click', async () => {
      try {
        await api('/api/auth/logout', undefined, 'POST');
        showSellerAuth('login');
      } catch (error) { notify(error.message); }
    });
    drawerContent.querySelectorAll('[data-listing-deactivate], [data-listing-activate]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.listingDeactivate || button.dataset.listingActivate;
        const status = button.dataset.listingDeactivate ? 'inactive' : 'active';
        try {
          await api(`/api/listings/${id}`, { status }, 'PATCH');
          await refreshListings();
          await renderSellerDashboard(user);
        } catch (error) { notify(error.message); }
      });
    });
    drawerContent.querySelectorAll('[data-order-picked-up], [data-order-cancel]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.orderPickedUp || button.dataset.orderCancel;
        const status = button.dataset.orderPickedUp ? 'picked_up' : 'cancelled';
        try {
          await api(`/api/orders/${id}/status`, { status }, 'PATCH');
          await refreshListings();
          await renderSellerDashboard(user);
        } catch (error) { notify(error.message); }
      });
    });
  } catch (error) {
    if (error.message === 'Authentication required.') return showSellerAuth('login');
    notify(error.message);
  }
}

async function refreshListings() {
  state.listings = await api('/api/listings');
  renderListings();
}

document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.filter').forEach((item) => item.classList.remove('active'));
  button.classList.add('active'); state.filter = button.dataset.filter; state.recommendations = []; document.querySelector('#ai-results').classList.add('hidden'); renderListings();
}));
document.querySelector('#ai-search-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = document.querySelector('#ai-query').value.trim();
  if (!query) return;
  const button = document.querySelector('#ai-search-button');
  const results = document.querySelector('#ai-results');
  button.disabled = true; button.textContent = 'Finding a good fit…';
  results.classList.add('hidden');
  state.recommendations = [];
  renderListings();
  try {
    const data = await api('/api/ai/recommend', { query });
    state.recommendations = data.recommendations || [];
    state.filter = 'All';
    document.querySelectorAll('.filter').forEach((filter) => filter.classList.toggle('active', filter.dataset.filter === 'All'));
    results.className = 'ai-results';
    results.innerHTML = `<p>${escapeHTML(data.message)}${state.recommendations.length ? ` <b>${state.recommendations.length} match${state.recommendations.length === 1 ? '' : 'es'} below.</b>` : ''}</p><button type="button" id="clear-ai-results">Show all finds</button>`;
    document.querySelector('#clear-ai-results').addEventListener('click', () => { state.recommendations = []; results.classList.add('hidden'); renderListings(); });
    renderListings();
  } catch (error) {
    results.className = 'ai-results error';
    results.innerHTML = `<p>${escapeHTML(error.message)}</p><button type="button" id="dismiss-ai-error">Dismiss</button>`;
    document.querySelector('#dismiss-ai-error').addEventListener('click', () => results.classList.add('hidden'));
  } finally {
    button.disabled = false; button.innerHTML = 'Find my match <span>↗</span>';
    results.classList.remove('hidden');
  }
});
document.querySelector('#open-seller').addEventListener('click', openSeller);
document.querySelector('#open-seller-lower').addEventListener('click', openSeller);
document.querySelector('#close-drawer').addEventListener('click', closeDrawer);
overlay.addEventListener('click', (event) => { if (event.target === overlay) closeDrawer(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && overlay.classList.contains('open')) closeDrawer(); });

async function init() {
  try {
    state.config = await api('/api/config');
    if (!state.config.aiConfigured) document.querySelector('.ai-discovery-copy span').textContent = 'Preview only: add an OpenAI API key to enable live matching.';
    await refreshListings();
  } catch (error) { notify(error.message); }
}

init();
