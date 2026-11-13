
async function shareListing(id) {
  const listing = state.listings.find(item => String(item.id) === String(id));
  if (!listing) return;
  const shareData = {
    title: `${listing.title} — LastPlate`,
    text: `Just found ${listing.title} at ${listing.shop} for ${money(listing.price)} (save ${listing.discountPercent || 50}%) before closing on LastPlate!`,
    url: window.location.origin + '#' + listing.id
  };
  try {
    if (navigator.share) {
      await navigator.share(shareData);
    } else {
      await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
      notify('Link and find details copied to clipboard!');
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      notify('Link copied to clipboard!');
    }
  }
}
window.shareListing = shareListing;


// Register PWA Service Worker
if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.debug('ServiceWorker notice:', err);
    });
  });
}

const state = { listings: [], filter: 'All', dietary: 'all', view: 'grid', config: null, selected: null, quantity: 1, paypalLoaded: false, recommendations: [], userLocation: null };
const grid = document.querySelector('#listing-grid');
const overlay = document.querySelector('#overlay');
const drawerContent = document.querySelector('#drawer-content');
const toast = document.querySelector('#toast');
let toastTimer;

const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = (amount) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: state.config?.currency || 'USD', maximumFractionDigits: 0 }).format(Number(amount || 0));

function haversineKm(startLat, startLng, endLat, endLng) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLat = toRad(endLat - startLat);
  const deltaLng = toRad(endLng - startLng);
  const lat1 = toRad(startLat);
  const lat2 = toRad(endLat);
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistanceText(km) {
  if (!Number.isFinite(km)) return 'Distance unavailable';
  if (km < 1) return `${Math.round(km * 1000)} m away`;
  if (km < 10) return `${km.toFixed(1)} km away`;
  return `${km.toFixed(0)} km away`;
}

function getDistanceForListing(listing) {
  if (!state.userLocation || !Number.isFinite(Number(listing?.lat)) || !Number.isFinite(Number(listing?.lng))) return null;
  return haversineKm(state.userLocation.lat, state.userLocation.lng, Number(listing.lat), Number(listing.lng));
}

function applyDistanceMetadata(items) {
  if (!state.userLocation) return items.map((listing) => ({ ...listing, distanceKm: null, distance: 'Distance unavailable' }));
  return items.map((listing) => {
    const distanceKm = getDistanceForListing(listing);
    return {
      ...listing,
      distanceKm,
      distance: distanceKm === null ? 'Distance unavailable' : formatDistanceText(distanceKm)
    };
  });
}

function sortByDistance(items) {
  if (!state.userLocation) return items;
  return [...items].sort((a, b) => {
    const distanceA = getDistanceForListing(a);
    const distanceB = getDistanceForListing(b);
    if (distanceA == null && distanceB == null) return 0;
    if (distanceA == null) return 1;
    if (distanceB == null) return -1;
    return distanceA - distanceB;
  });
}

const postalCodeLookup = {
  M5V: { lat: 43.6407, lng: -79.3886, label: 'Toronto (M5V)' },
  M5R: { lat: 43.6704, lng: -79.3924, label: 'Toronto (M5R)' },
  M5T: { lat: 43.6506, lng: -79.3965, label: 'Toronto (M5T)' },
  M5S: { lat: 43.6629, lng: -79.3983, label: 'Toronto (M5S)' },
  M5B: { lat: 43.6572, lng: -79.3791, label: 'Toronto (M5B)' },
  M6G: { lat: 43.6652, lng: -79.4291, label: 'Toronto (M6G)' },
  M4Y: { lat: 43.6625, lng: -79.3839, label: 'Toronto (M4Y)' },
  M4B: { lat: 43.7086, lng: -79.3120, label: 'Toronto (M4B)' },
  M5A: { lat: 43.6509, lng: -79.3841, label: 'Toronto (M5A)' },
  M5C: { lat: 43.6527, lng: -79.3750, label: 'Toronto (M5C)' },
  M5E: { lat: 43.6463, lng: -79.3730, label: 'Toronto (M5E)' },
  M5H: { lat: 43.6498, lng: -79.3829, label: 'Toronto (M5H)' },
  M5J: { lat: 43.6413, lng: -79.3894, label: 'Toronto (M5J)' }
};

function normalizePostalCode(value) {
  const cleaned = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return null;
  if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(cleaned)) return cleaned;
  if (/^[A-Z]\d[A-Z]\s*\d[A-Z]\d$/.test(cleaned.replace(/\s+/g, ''))) return cleaned.replace(/\s+/g, '');
  return null;
}

function resolvePostalCodeLocation(input) {
  const cleaned = normalizePostalCode(input);
  if (!cleaned) return null;
  const prefix = cleaned.slice(0, 3);
  const anchor = postalCodeLookup[prefix] || {
    lat: 43.6532 + ((prefix.charCodeAt(0) - 65) / 18) * 0.14,
    lng: -79.3832 + (((prefix.charCodeAt(1) % 5) - 2) * 0.12),
    label: `Toronto (${prefix})`
  };
  return { ...anchor, label: anchor.label || `Toronto (${prefix})`, source: 'postal-code' };
}

function setUserLocation(location, { persist = true } = {}) {
  state.userLocation = location ? { lat: Number(location.lat), lng: Number(location.lng), label: location.label || 'My location', source: location.source || 'manual' } : null;
  if (persist) {
    try {
      if (state.userLocation) localStorage.setItem('lastplate_user_location', JSON.stringify(state.userLocation));
      else localStorage.removeItem('lastplate_user_location');
    } catch (error) {
      console.warn('Could not persist user location:', error);
    }
  }
  updateLocationPill();
}

function loadUserLocation() {
  try {
    const saved = localStorage.getItem('lastplate_user_location');
    if (!saved) return;
    const parsed = JSON.parse(saved);
    if (parsed && Number.isFinite(Number(parsed.lat)) && Number.isFinite(Number(parsed.lng))) {
      state.userLocation = { ...parsed, source: parsed.source || 'saved' };
    }
  } catch (error) {
    console.warn('Could not restore user location:', error);
  }
  updateLocationPill();
}

function toggleLocationMenu(forceOpen) {
  const menu = document.querySelector('#location-menu');
  const pill = document.querySelector('#location-pill-button');
  if (!menu || !pill) return;
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !shouldOpen);
  pill.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
}

function updateLocationPill() {
  const label = document.querySelector('#location-pill-label');
  if (!label) return;
  if (state.userLocation) {
    label.textContent = state.userLocation.label || 'My location';
  } else {
    label.textContent = 'Use my location';
  }
}

function clearLocation() {
  setUserLocation(null);
  toggleLocationMenu(false);
  renderListings();
}

function requestUserLocation() {
  const geolocationSupported = 'geolocation' in navigator;
  if (!geolocationSupported) {
    notify('This browser cannot access your location. Try a postal code instead.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const location = {
        lat: coords.latitude,
        lng: coords.longitude,
        label: 'My current location',
        source: 'browser'
      };
      setUserLocation(location);
      toggleLocationMenu(false);
      renderListings();
      notify('Using your current location to sort nearby finds.');
    },
    () => {
      notify('Location access was denied. Try a postal code or select a city manually.');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

function applyPostalCodeLocation() {
  const input = document.querySelector('#postal-code-input');
  if (!input) return;
  const value = input.value.trim();
  const location = resolvePostalCodeLocation(value);
  if (!location) {
    notify('Please enter a valid postal code like M5V 2T6.');
    return;
  }
  setUserLocation({ lat: location.lat, lng: location.lng, label: location.label, source: 'postal-code' });
  toggleLocationMenu(false);
  renderListings();
  notify(`Showing nearby results for ${location.label}.`);
}

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


/* --- Audio Chime, Confetti & Countdown Helpers --- */
let audioCtx = null;
function playCelebrationChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;

    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.18, now + 0.04);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start(now);
    osc1.stop(now + 0.5);

    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880.0, now + 0.12);
    gain2.gain.setValueAtTime(0, now + 0.12);
    gain2.gain.linearRampToValueAtTime(0.22, now + 0.16);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.8);
  } catch (e) {
    console.debug('Audio chime note:', e);
  }
}

function fireConfetti() {
  const canvas = document.querySelector('#confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const colors = ['#29503b', '#e5f090', '#ef9864', '#5fa86c', '#f5e4b7', '#3b7a54'];
  const particles = [];
  for (let i = 0; i < 70; i++) {
    particles.push({
      x: canvas.width * 0.5 + (Math.random() - 0.5) * 220,
      y: canvas.height * 0.35,
      vx: (Math.random() - 0.5) * 12,
      vy: (Math.random() - 1.2) * 11 - 2,
      size: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      tilt: Math.random() * 10,
      tiltAngle: Math.random() * Math.PI,
      tiltAngleInc: Math.random() * 0.08 + 0.04,
      alpha: 1
    });
  }
  let animationFrame;
  let startTime = performance.now();
  function render(now) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const elapsed = (now - startTime) / 1000;
    let active = false;
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.28;
      p.tiltAngle += p.tiltAngleInc;
      p.tilt = Math.sin(p.tiltAngle) * 12;
      if (elapsed > 1.6) p.alpha = Math.max(0, p.alpha - 0.02);
      if (p.y < canvas.height && p.alpha > 0) {
        active = true;
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.size, p.size * 0.5, p.tiltAngle, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    if (active && elapsed < 3) {
      animationFrame = requestAnimationFrame(render);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      cancelAnimationFrame(animationFrame);
    }
  }
  animationFrame = requestAnimationFrame(render);
}

function parsePickupMinutes(pickupBy) {
  if (!pickupBy) return null;
  const match = String(pickupBy).match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridian = match[3] ? match[3].toLowerCase() : null;
  if (meridian === 'pm' && hours < 12) hours += 12;
  if (meridian === 'am' && hours === 12) hours = 0;
  const now = new Date();
  const target = new Date();
  target.setHours(hours, minutes, 0, 0);
  let diffMinutes = Math.round((target - now) / 60000);
  if (diffMinutes < -120) target.setDate(target.getDate() + 1);
  diffMinutes = Math.round((target - now) / 60000);
  return diffMinutes;
}

function getCountdownBadge(pickupBy) {
  const diff = parsePickupMinutes(pickupBy);
  if (diff === null) return `<span class="countdown-badge">⏱ ${escapeHTML(pickupBy)}</span>`;
  if (diff <= 0) return `<span class="countdown-badge closing-soon">⚡ Ending now</span>`;
  if (diff < 60) return `<span class="countdown-badge closing-soon">⚡ ${diff}m left</span>`;
  const hours = Math.floor(diff / 60);
  const mins = diff % 60;
  return `<span class="countdown-badge">⏱ ${hours}h ${mins > 0 ? mins + 'm' : ''} left</span>`;
}

/* --- Leaflet Map Controller --- */
let leafletMap = null;
let mapMarkers = [];

function initOrUpdateMap(listings) {
  const mapEl = document.querySelector('#map-view');
  if (!mapEl || typeof L === 'undefined') return;
  if (!leafletMap) {
    leafletMap = L.map('map-view', {
      center: [43.6495, -79.3905],
      zoom: 14,
      zoomControl: true
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(leafletMap);
  }
  mapMarkers.forEach(m => leafletMap.removeLayer(m));
  mapMarkers = [];

  listings.forEach(listing => {
    if (!listing.lat || !listing.lng) return;
    const pinHtml = `<div class="custom-map-pin"><img src="/images/logo-icon.png" alt="pin" style="width:26px; height:26px; object-fit:contain; transform:rotate(45deg);"></div>`;
    const customIcon = L.divIcon({
      html: pinHtml,
      className: '',
      iconSize: [44, 44],
      iconAnchor: [22, 44],
      popupAnchor: [0, -42]
    });
    const popupHtml = `
      <div class="map-popup-card">
        ${listing.imageUrl ? `<img class="map-popup-img" src="${escapeHTML(listing.imageUrl)}" alt="${escapeHTML(listing.title)}">` : ''}
        <div class="map-popup-shop">${escapeHTML(listing.shop)}</div>
        <div class="map-popup-title">${escapeHTML(listing.title)}</div>
        <div class="map-popup-price">${money(listing.price)} <small style="color:#788474;font-size:11px;font-weight:500;">· 📍 ${escapeHTML(listing.distance || 'Downtown')}</small></div>
        <button type="button" class="map-popup-btn" onclick="openListing('${listing.id}')">View bundle ↗</button>
      </div>
    `;
    const marker = L.marker([listing.lat, listing.lng], { icon: customIcon })
      .addTo(leafletMap)
      .bindPopup(popupHtml);
    mapMarkers.push(marker);
  });

  if (mapMarkers.length > 0) {
    const group = L.featureGroup(mapMarkers);
    leafletMap.fitBounds(group.getBounds().pad(0.18));
  }
  setTimeout(() => {
    if (leafletMap) leafletMap.invalidateSize();
  }, 250);
}

/* --- POS Audio Chime Synthesizer --- */
function playSuccessBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.24);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
  } catch (e) {
    // audio context muted or restricted by browser policy
  }
}

/* --- Camera QR Scanner Controller --- */
let cameraStream = null;
let cameraScanning = false;

async function startCameraScanner(onCodeDetected) {
  const modal = document.querySelector('#camera-modal');
  const video = document.querySelector('#scanner-video');
  if (!modal || !video) return;
  modal.classList.remove('hidden');

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = cameraStream;
    await video.play();
    cameraScanning = true;

    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const detectLoop = async () => {
        if (!cameraScanning) return;
        try {
          const barcodes = await detector.detect(video);
          if (barcodes && barcodes.length > 0) {
            const rawValue = barcodes[0].rawValue;
            stopCameraScanner();
            playSuccessBeep();
            onCodeDetected(rawValue);
            return;
          }
        } catch (e) {
          console.debug('Barcode detect loop:', e);
        }
        if (cameraScanning) requestAnimationFrame(detectLoop);
      };
      requestAnimationFrame(detectLoop);
    } else {
      notify('Tip: Point camera or enter the 4-digit code directly below.');
    }
  } catch (err) {
    notify('Camera notice: ' + (err.message || 'Permission denied'));
    stopCameraScanner();
  }
}

function stopCameraScanner() {
  cameraScanning = false;
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  const modal = document.querySelector('#camera-modal');
  if (modal) modal.classList.add('hidden');
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function generateQRMatrix(text) {
  const size = 21;
  const grid = Array.from({ length: size }, () => Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));

  function setModule(r, c, val, isRes = true) {
    grid[r][c] = val ? 1 : 0;
    if (isRes) reserved[r][c] = true;
  }

  function addFinder(r0, c0) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const nr = r0 + r, nc = c0 + c;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        const isBlack = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        setModule(nr, nc, isBlack);
      }
    }
  }
  addFinder(0, 0);
  addFinder(0, 14);
  addFinder(14, 0);

  for (let i = 8; i < 13; i++) {
    setModule(6, i, i % 2 === 0);
    setModule(i, 6, i % 2 === 0);
  }
  setModule(13, 8, true);

  for (let i = 0; i < 9; i++) {
    if (i !== 6) { reserved[8][i] = true; reserved[i][8] = true; }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }

  const bytes = new TextEncoder().encode(String(text || 'LP-SAVED').slice(0, 14));
  const bits = [];
  const pushBits = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  pushBits(4, 4);
  pushBits(bytes.length, 8);
  for (const b of bytes) pushBits(b, 8);
  for (let i = 0; i < 4 && bits.length < 128; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const pads = [0xec, 0x11];
  let padIdx = 0;
  while (bits.length < 128) {
    pushBits(pads[padIdx % 2], 8);
    padIdx++;
  }

  const dataCodewords = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    let byteVal = 0;
    for (let j = 0; j < 8; j++) byteVal = (byteVal << 1) | bits[i * 8 + j];
    dataCodewords[i] = byteVal;
  }

  const GF256 = new Uint8Array(512), LOG256 = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) { GF256[i] = GF256[i + 255] = x; LOG256[x] = i; x = (x << 1) ^ (x >= 128 ? 0x11d : 0); }
  const gfMul = (x, y) => (x === 0 || y === 0) ? 0 : GF256[LOG256[x] + LOG256[y]];
  const genPoly = [1, 216, 194, 159, 111, 199, 94, 95, 113, 157, 193];

  const ecCodewords = new Uint8Array(10);
  const fullBytes = new Uint8Array(26);
  fullBytes.set(dataCodewords);
  for (let i = 0; i < 16; i++) {
    const factor = fullBytes[i];
    if (factor !== 0) {
      for (let j = 0; j < genPoly.length; j++) fullBytes[i + j] ^= gfMul(genPoly[j], factor);
    }
  }
  for (let i = 0; i < 10; i++) ecCodewords[i] = fullBytes[16 + i];

  const allBits = [];
  for (const b of dataCodewords) for (let i = 7; i >= 0; i--) allBits.push((b >> i) & 1);
  for (const b of ecCodewords) for (let i = 7; i >= 0; i--) allBits.push((b >> i) & 1);

  let bitIdx = 0;
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--;
    const rows = upward ? Array.from({ length: size }, (_, i) => size - 1 - i) : Array.from({ length: size }, (_, i) => i);
    for (const r of rows) {
      for (const c of [right, right - 1]) {
        if (!reserved[r][c]) {
          const bit = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
          const mask = ((r + c) % 2 === 0) ? 1 : 0;
          grid[r][c] = bit ^ mask;
        }
      }
    }
    upward = !upward;
  }

  const formatBits = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];
  const tlCoords = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
  ];
  for (let i = 0; i < 15; i++) {
    const [r, c] = tlCoords[i];
    grid[r][c] = formatBits[i];
  }
  for (let i = 0; i < 7; i++) grid[size - 1 - i][8] = formatBits[i];
  for (let i = 0; i < 8; i++) grid[8][size - 8 + i] = formatBits[7 + i];

  return grid;
}

function renderQRCodeSVG(text, size = 130) {
  try {
    const matrix = generateQRMatrix(String(text || 'LP-SAVED'));
    const n = matrix.length;
    const padding = 2;
    const total = n + padding * 2;
    let paths = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (matrix[r][c]) paths += `M${c + padding},${r + padding}h1v1h-1z `;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" class="ticket-qr-svg" role="img" aria-label="QR Code"><rect width="${total}" height="${total}" fill="#fff"/><path d="${paths}" fill="#1d2b22"/></svg>`;
  } catch {
    return '';
  }
}

function getBuyerPickups() {
  try {
    const data = localStorage.getItem('lastplate_pickups');
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveBuyerPickup(order) {
  try {
    const list = getBuyerPickups();
    if (!list.some(item => item.pickupCode === order.pickupCode)) {
      list.unshift(order);
      localStorage.setItem('lastplate_pickups', JSON.stringify(list.slice(0, 20)));
    }
    updatePickupsBadge();
  } catch (e) {
    console.error('Could not save pickup to localStorage:', e);
  }
}

function updatePickupsBadge() {
  const badge = document.querySelector('#my-pickups-badge');
  if (!badge) return;
  const list = getBuyerPickups();
  if (list.length > 0) {
    badge.textContent = list.length;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

/* --- Drop Alert & Favorite Store System --- */
function getFavoriteShops() {
  try {
    const data = localStorage.getItem('lastplate_favorite_shops');
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function toggleFavoriteShop(shopName, btnEl) {
  try {
    const favs = getFavoriteShops();
    const idx = favs.indexOf(shopName);
    let active = false;
    if (idx >= 0) {
      favs.splice(idx, 1);
      active = false;
    } else {
      favs.push(shopName);
      active = true;
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(perm => {
          if (perm === 'granted') {
            notify(`🔔 Notifications enabled for ${shopName}!`);
          }
        });
      }
    }
    localStorage.setItem('lastplate_favorite_shops', JSON.stringify(favs));
    updateFavoritesBadge();

    if (btnEl) {
      btnEl.classList.toggle('active', active);
      btnEl.setAttribute('aria-pressed', String(active));
      if (btnEl.classList.contains('save-tag')) {
        btnEl.innerHTML = active ? '♥' : '♡';
      } else if (btnEl.id === 'drawer-toggle-alert') {
        btnEl.innerHTML = `<span>🔔</span> <b>${active ? 'Following for Drop Alerts ✓' : 'Notify me when ' + escapeHTML(shopName) + ' drops surplus'}</b>`;
      }
    }

    if (active) {
      notify(`🔔 Drop Alert Set: You will be notified when ${shopName} adds surplus!`);
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('LastPlate Drop Alert Active 🔔', {
            body: `We will alert you when ${shopName} drops fresh surprise bags!`,
            icon: '/favicon-32.png'
          });
        } catch { }
      }
    } else {
      notify(`Removed ${shopName} from your drop alerts.`);
    }

    if (state.filter === 'Favorites') {
      renderListings();
    }
  } catch (e) {
    console.error('Favorite toggle error:', e);
  }
}
window.toggleFavoriteShop = toggleFavoriteShop;

function updateFavoritesBadge() {
  const badge = document.querySelector('#count-favorites');
  if (!badge) return;
  const favs = getFavoriteShops();
  badge.textContent = favs.length;
}

function checkActiveDropAlerts() {
  const favs = getFavoriteShops();
  if (!favs.length || !state.listings.length) return;
  const activeMatching = state.listings.filter(l => favs.includes(l.shop) && Number(l.quantity) > 0);
  if (activeMatching.length > 0) {
    const uniqueShops = [...new Set(activeMatching.map(l => l.shop))];
    const dropToastKey = 'lastplate_drop_alert_seen_' + new Date().toDateString();
    if (!sessionStorage.getItem(dropToastKey)) {
      sessionStorage.setItem(dropToastKey, 'true');
      setTimeout(() => {
        notify(`🔔 Drop Alert: ${uniqueShops.join(', ')} has fresh surplus available right now!`);
      }, 1500);
    }
  }
}

function renderListings() {
  const favs = getFavoriteShops();
  updateFavoritesBadge();
  const filtered = state.listings.filter((listing) => {
    let catMatch = true;
    if (state.filter === 'Favorites') {
      catMatch = favs.includes(listing.shop);
    } else if (state.filter !== 'All') {
      catMatch = listing.category.toLowerCase() === state.filter.toLowerCase();
    }
    const dietMatch = state.dietary === 'all' || (Array.isArray(listing.dietary) && listing.dietary.includes(state.dietary));
    return catMatch && dietMatch;
  });
  const matches = new Map(state.recommendations.map((item) => [String(item.listingId), item.reason]));
  let visible = state.recommendations.length
    ? state.recommendations.map((item) => state.listings.find((listing) => String(listing.id) === String(item.listingId))).filter(Boolean)
    : filtered;

  if (state.userLocation) {
    visible = sortByDistance(applyDistanceMetadata(visible));
  } else {
    visible = applyDistanceMetadata(visible);
  }

  document.querySelector('#count-all').textContent = state.listings.length;
  document.querySelector('#empty-state').classList.toggle('hidden', visible.length > 0);

  const mapEl = document.querySelector('#map-view');
  if (state.view === 'map') {
    grid.classList.add('hidden');
    if (mapEl) {
      mapEl.classList.remove('hidden');
      initOrUpdateMap(visible);
    }
    return;
  } else {
    grid.classList.remove('hidden');
    if (mapEl) mapEl.classList.add('hidden');
  }

  grid.innerHTML = visible.map((listing) => {
    const categoryClass = listing.category.toLowerCase() === 'bakery' ? 'bakery' : listing.category.toLowerCase() === 'cafe' ? 'cafe' : 'other';
    const isUrgent = Number(listing.quantity) <= 2;
    const discount = listing.discountPercent || 0;
    const countdown = getCountdownBadge(listing.pickupBy);
    const distanceText = state.userLocation ? `📍 ${escapeHTML(listing.distance || 'Distance unavailable')}` : '📍 ' + escapeHTML(listing.distance || 'Distance unavailable');
    return `<article class="listing-card" data-id="${escapeHTML(listing.id)}" tabindex="0" role="button" aria-label="View ${escapeHTML(listing.title)}">
      <div class="card-art ${categoryClass}">
        ${listing.imageUrl ? `<img class="card-photo" src="${escapeHTML(listing.imageUrl)}" alt="${escapeHTML(listing.title)}" loading="lazy" onerror="this.style.display='none';" />` : ''}
        <div class="card-photo-overlay"></div>
        <div class="card-top-tags">
          <span class="category-tag">${escapeHTML(listing.category.toUpperCase())}</span>
          ${discount > 0 ? `<span class="discount-pill">Save ${discount}%</span>` : ''}
          ${countdown}
        </div>
        <span class="card-emoji card-emoji-fallback" aria-hidden="true">${escapeHTML(listing.image || '🥖')}</span>
        <button class="card-share-btn" type="button" aria-label="Share find" onclick="event.stopPropagation(); shareListing('${listing.id}');">🔗</button>
        <button class="save-tag ${favs.includes(listing.shop) ? 'active' : ''}" type="button" aria-label="Drop alert for ${escapeHTML(listing.shop)}" title="Get Drop Alerts for ${escapeHTML(listing.shop)}" onclick="event.stopPropagation(); toggleFavoriteShop('${escapeHTML(listing.shop)}', this);">${favs.includes(listing.shop) ? '♥' : '♡'}</button>
        <div class="card-bottom-tags">
          <span class="distance-pill">${distanceText}</span>
        </div>
      </div>
      <div class="card-body">
        <div class="card-shop-row">
          <span class="card-shop">${escapeHTML(listing.shop)}</span>
          <span class="card-rating">★ ${listing.rating || '4.9'} <small>(${listing.reviews || '42'})</small></span>
        </div>
        <div class="card-title-row">
          <h3 class="card-title">${escapeHTML(listing.title)}</h3>
          <div class="price">
            <strong>${money(listing.price)}</strong>
            ${listing.originalValue ? `<del>${money(listing.originalValue)}</del>` : ''}
          </div>
        </div>
        <p class="card-description">${escapeHTML(listing.description)}</p>
        ${matches.has(String(listing.id)) ? `<div class="ai-match-reason"><span>✳</span> ${escapeHTML(matches.get(String(listing.id)))}</div>` : ''}
        <div class="card-meta">
          <span class="pickup-time"><span>◷</span> ${escapeHTML(listing.pickupBy)}</span>
          <span class="stock ${isUrgent ? 'urgency-stock' : ''}">${isUrgent ? `⚡ Only ${listing.quantity} left` : `${listing.quantity} left`}</span>
        </div>
      </div>
    </article>`;
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
  const isUrgent = Number(listing.quantity) <= 2;
  const discount = listing.discountPercent || 0;
  const favs = getFavoriteShops();
  const isFav = favs.includes(listing.shop);
  const checkout = isDemo
    ? `<div class="checkout-wrap"><button class="demo-checkout" id="demo-checkout">Reserve for pickup</button><p class="demo-note"><span class="demo-badge">Demo only</span> No payment is taken in this demo flow.</p></div>`
    : `<div class="checkout-wrap"><div id="paypal-buttons" class="paypal-area"></div><p class="demo-note">PayPal sandbox · no real money</p></div>`;

  drawerContent.innerHTML = `
    <div class="drawer-art">
      ${listing.imageUrl ? `<img class="drawer-photo" src="${escapeHTML(listing.imageUrl)}" alt="${escapeHTML(listing.title)}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />` : ''}
      <div class="drawer-emoji-fallback" style="${listing.imageUrl ? 'display:none;' : ''}"><span>${escapeHTML(listing.image || '🥖')}</span></div>
      ${discount > 0 ? `<span class="drawer-discount-tag">Save ${discount}%</span>` : ''}
    </div>
    <div class="drawer-header-meta">
      <span class="drawer-shop-badge">🏪 <b>${escapeHTML(listing.shop)}</b></span>
      <span class="drawer-rating-badge">★ ${listing.rating || '4.9'} (${listing.reviews || '42'} reviews)</span>
    </div>
    <div class="drawer-alert-row">
      <button type="button" class="drawer-alert-btn ${isFav ? 'active' : ''}" id="drawer-toggle-alert">
        <span>🔔</span> <b>${isFav ? 'Following for Drop Alerts ✓' : 'Notify me when ' + escapeHTML(listing.shop) + ' drops surplus'}</b>
      </button>
    </div>
    <h2 class="drawer-title" id="drawer-title">${escapeHTML(listing.title)}</h2>
    <p class="drawer-desc">${escapeHTML(listing.description)}</p>
    <div class="drawer-impact-box">
      <span class="impact-icon">🌱</span>
      <div class="impact-text">
        <strong>Saves ~${listing.co2Saved || '2.1 kg'} CO₂ emissions</strong>
        <span>Rescuing this food prevents carbon waste and keeps fresh meals out of landfills.</span>
      </div>
    </div>
    <div class="drawer-tags">${tags}</div>
    <div class="detail-box">
      <div class="detail-line"><span>Pick up by</span><b>${escapeHTML(listing.pickupBy)}</b></div>
      <div class="detail-line"><span>Distance & walk</span><b>${escapeHTML(listing.distance || '0.5 km · 7 min walk')}</b></div>
      <div class="detail-line"><span>Address</span><b>${escapeHTML(listing.address || 'See shop for location')}</b></div>
      <div class="detail-line"><span>Availability</span><b class="${isUrgent ? 'urgency-stock' : ''}">${isUrgent ? `⚡ Only ${listing.quantity} left` : `${listing.quantity} left`}</b></div>
    </div>
    <div class="allergen-note"><b>Ingredients & allergens from the shop</b><br>${escapeHTML(listing.ingredients || 'Ask the shop directly about ingredients and allergens.')}</div>
    <button type="button" class="share-find-btn" id="drawer-share-find">🔗 Share this find with a friend</button>
    <div class="buy-row">
      <div class="buy-price" id="buy-price">
        ${money(listing.price)} <small>/ bundle</small>
        ${listing.originalValue ? `<del class="buy-original">${money(listing.originalValue)}</del>` : ''}
      </div>
      <div class="quantity">
        <button id="quantity-minus" aria-label="Remove one">−</button>
        <span id="quantity-count">1</span>
        <button id="quantity-plus" aria-label="Add one">+</button>
      </div>
    </div>
    ${checkout}`;
  openDrawer();
  document.querySelector('#drawer-toggle-alert')?.addEventListener('click', (e) => {
    toggleFavoriteShop(listing.shop, e.currentTarget);
  });
  document.querySelector('#drawer-share-find')?.addEventListener('click', () => {
    shareListing(listing.id);
  });
  const updateQuantity = (next) => {
    state.quantity = Math.max(1, Math.min(listing.quantity, next));
    document.querySelector('#quantity-count').textContent = state.quantity;
    document.querySelector('#buy-price').innerHTML = `
      ${money(listing.price * state.quantity)} <small>/ ${state.quantity} bundle${state.quantity === 1 ? '' : 's'}</small>
      ${listing.originalValue ? `<del class="buy-original">${money(listing.originalValue * state.quantity)}</del>` : ''}
    `;
  };
  document.querySelector('#quantity-minus').addEventListener('click', () => updateQuantity(state.quantity - 1));
  document.querySelector('#quantity-plus').addEventListener('click', () => updateQuantity(state.quantity + 1));
  if (isDemo) document.querySelector('#demo-checkout').addEventListener('click', () => demoPurchase(listing));
  else mountPaypal(listing);
}
window.openListing = openListing;

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
  playCelebrationChime();
  fireConfetti();
  const pickupCode = result.pickupCode || 'SAVED';
  const title = result.listing || state.selected?.title || 'Surplus bundle';
  const qrSVG = renderQRCodeSVG(pickupCode, 130);

  saveBuyerPickup({
    id: result.orderId || Date.now(),
    pickupCode,
    title,
    shop: state.selected?.shop || 'Local shop',
    address: state.selected?.address || 'See shop for location',
    pickupBy: state.selected?.pickupBy || 'Today before closing',
    quantity: state.quantity || 1,
    price: (state.selected?.price || 0) * (state.quantity || 1),
    demo: Boolean(demo),
    createdAt: new Date().toISOString()
  });

  drawerContent.innerHTML = `
    <div class="pickup-success">
      <div class="success-icon">✓</div>
      <span class="demo-badge">${demo ? 'Demo reservation' : 'Sandbox payment complete'}</span>
      <h2>You saved a little something.</h2>
      <p>${demo ? 'Your demo pickup has been reserved.' : 'Your PayPal sandbox payment is complete.'} Show this pass or pickup code at the shop before closing to collect your <b>${escapeHTML(title)}</b>.</p>
      <div class="pickup-pass-card">
        <div class="pass-qr">${qrSVG}</div>
        <div class="pickup-code">YOUR PICKUP CODE<strong>${escapeHTML(pickupCode)}</strong></div>
        <div class="pass-details">
          <div><span>Shop</span><b>${escapeHTML(state.selected?.shop || 'Local shop')}</b></div>
          <div><span>Pick up by</span><b>${escapeHTML(state.selected?.pickupBy || 'Today, closing')}</b></div>
          <div><span>Quantity</span><b>${state.quantity || 1} bundle${(state.quantity || 1) === 1 ? '' : 's'}</b></div>
        </div>
      </div>

      <div class="pass-actions">
        <button class="button button-dark" id="done-button" style="width:100%;justify-content:center">Lovely, thanks <span>✓</span></button>
        <button class="button button-outline" id="view-pickups-btn" style="width:100%;justify-content:center;margin-top:8px">View all my pickups <span>↗</span></button>
      </div>
    </div>
  `;

  document.querySelector('#done-button').addEventListener('click', async () => { closeDrawer(); await refreshListings(); });
  document.querySelector('#view-pickups-btn').addEventListener('click', () => renderMyPickups());
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
  drawerContent.innerHTML = `<div class="seller-head"><div class="eyebrow"><span class="eyebrow-dot"></span> FOR LOCAL SHOPS</div><h2 id="drawer-title">Make a little extra<br>go a little further.</h2><p>List your closing picks with a few quick details; the AI helper can draft the copy, and you stay in control before publishing.</p></div>
    <form id="seller-form">
      <label class="form-label" for="shop-name">Shop name</label><input class="form-control" id="shop-name" name="shop" required value="${escapeHTML(user?.name || 'Morrow & Rye')}" readonly>
      <div class="form-grid"><div><label class="form-label" for="category">Shop type</label><select class="form-control" id="category" name="category"><option>Bakery</option><option>Cafe</option><option>Market</option></select></div><div><label class="form-label" for="price">Offer price</label><input class="form-control" id="price" name="price" type="number" min="1" step="0.5" value="7.5" required></div></div>
      <label class="form-label" for="items">What’s in the surplus?</label>
      <div class="merchant-presets" role="group" aria-label="Quick surplus templates">
        <button type="button" class="preset-btn" data-preset="pastries">🥐 4 Croissants & Pastries</button>
        <button type="button" class="preset-btn" data-preset="bread">🥖 2 Sourdough Loaves</button>
        <button type="button" class="preset-btn" data-preset="lunch">🥪 3 Lunch Sandwiches</button>
        <button type="button" class="preset-btn" data-preset="treats">☕ 3 Cold Brews & Scones</button>
      </div>
      <textarea class="form-control" id="items" name="items" rows="3" placeholder="e.g. 2 croissants, 1 sourdough loaf, 3 morning buns" required></textarea><p class="form-help">The writing assistant reads your notes and helps draft a description, but you review it before publishing.</p>
      <div class="form-grid"><div><label class="form-label" for="original-value">Usual value per bundle</label><input class="form-control" id="original-value" name="originalValue" type="number" min="0" step="0.5" value="24" required></div><div><label class="form-label" for="quantity">Bundle quantity</label><input class="form-control" id="quantity" name="quantity" type="number" min="1" max="50" value="4" required></div></div>
      <div class="form-grid"><div><label class="form-label" for="pickup-by">Pick up by</label><input class="form-control" id="pickup-by" name="pickupBy" value="Today, 7:00 pm" required></div><div><label class="form-label" for="address">Pickup address</label><input class="form-control" id="address" name="address" value="12 King Street West" required></div></div>
      <label class="form-label" for="ingredients">Ingredients & allergen information</label><textarea class="form-control" id="ingredients" name="ingredients" rows="2" placeholder="Only include ingredient and allergen information you are confident about." required></textarea>
      <label class="form-label" for="notes">Other seller notes</label><input class="form-control" id="notes" name="notes" placeholder="e.g. packed in a paper bag">
      <div class="seller-actions"><button class="button button-outline" id="draft-button" type="button">✦ Draft with AI</button><button class="button button-dark" id="publish-button" type="submit">Publish find <span>↗</span></button></div>
      <div class="ai-status"><span class="ai-stars">✳</span><span id="ai-status-text">AI makes a first draft; you stay in control.</span></div><div id="seller-preview"></div>
    </form>`;
  openDrawer();
  if (!state.config?.aiConfigured) document.querySelector('#ai-status-text').textContent = 'Demo writing helper; add an API key for generated drafts.';
  const form = document.querySelector('#seller-form');
  const presets = {
    pastries: { items: '4 butter croissants, 2 pain au chocolat, 1 almond danish', val: 24, price: 7.5, cat: 'Bakery' },
    bread: { items: '2 country sourdough loaves, 1 sesame focaccia slab', val: 22, price: 6.5, cat: 'Bakery' },
    lunch: { items: '3 seasonal vegetarian deli sandwiches, 2 side market greens', val: 32, price: 9.5, cat: 'Cafe' },
    treats: { items: '3 cold brew bottles, 3 blueberry lemon scones', val: 26, price: 8, cat: 'Cafe' }
  };
  form.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = presets[btn.dataset.preset];
      if (!p) return;
      form.querySelector('#items').value = p.items;
      form.querySelector('#original-value').value = p.val;
      form.querySelector('#price').value = p.price;
      form.querySelector('#category').value = p.cat;
      notify('Template filled. Click "✦ Draft with AI" to generate the description!');
    });
  });
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
      document.querySelector('#seller-preview').innerHTML = `<div class="seller-preview"><b>Review and edit your AI draft · suggested ${money(draft.suggestedPrice)}</b><label class="form-label" for="draft-title">Title</label><input class="form-control" id="draft-title" value="${escapeHTML(draft.title)}"><label class="form-label" for="draft-description">Description</label><textarea class="form-control" id="draft-description" rows="4">${escapeHTML(draft.description)}</textarea></div>`;
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
      const result = await api('/api/listings', { ...values, title: approvedTitle, description: approvedDescription, image: values.category === 'Bakery' ? '🥐' : values.category === 'Cafe' ? '☕' : '🥬' });
      await refreshListings(); await renderSellerDashboard(user); notify('Your surplus is on the menu.');
    } catch (error) { notify(error.message); button.disabled = false; button.innerHTML = 'Publish find <span>↗</span>'; }
  });
}

function showSellerAuth(mode = 'login') {
  const isSignup = mode === 'signup';
  drawerContent.innerHTML = `<section class="seller-auth"><div class="eyebrow"><span class="eyebrow-dot"></span> FOR LOCAL SHOPS</div><h2>${isSignup ? 'Create your shop account' : 'Welcome back'}</h2><p>${isSignup ? 'List your surplus in minutes and manage pickups without stress.' : 'Sign in to keep your menu, orders, and pickup verification in sync.'}</p>
    <form id="seller-auth-form">
      ${isSignup ? '<label class="form-label" for="seller-name">Shop name</label><input class="form-control" id="seller-name" name="name" maxlength="120" autocomplete="organization" required>' : ''}
      <label class="form-label" for="seller-email">Email</label><input class="form-control" id="seller-email" name="email" type="email" autocomplete="email" required>
      <label class="form-label" for="seller-password">Password</label><input class="form-control" id="seller-password" name="password" type="password" minlength="8" maxlength="100" autocomplete="current-password" required>
      <button class="button button-dark" type="submit" style="width:100%;justify-content:center;margin-top:18px">${isSignup ? 'Create account' : 'Sign in'} <span>↗</span></button>
    </form>
    <p class="seller-auth-switch">${isSignup ? 'Already have a shop account?' : 'New to LastPlate?'} <button id="seller-auth-toggle" type="button">${isSignup ? 'Sign in' : 'Create an account'}</button></p>
  </section>`;
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

function renderMyPickups() {
  state.selected = null;
  const pickups = getBuyerPickups();
  drawerContent.innerHTML = `
    <div class="my-pickups-head">
      <div class="eyebrow"><span class="eyebrow-dot"></span> YOUR ORDERS</div>
      <h2 id="drawer-title">My Pickup Passes</h2>
      <p>Show these tickets to store clerks when picking up your food before closing time.</p>
    </div>
    ${pickups.length ? `
      <div class="user-impact-card">
        <div class="user-impact-title">🌱 Your Food Rescue Impact</div>
        <div class="user-impact-stats">
          <div><strong>${pickups.reduce((acc, t) => acc + (Number(t.quantity) || 1), 0)}</strong><span>Meals saved</span></div>
          <div><strong>$${(pickups.reduce((acc, t) => acc + (Number(t.quantity) || 1), 0) * 14.5).toFixed(0)}</strong><span>Dollars saved</span></div>
          <div><strong>${(pickups.reduce((acc, t) => acc + (Number(t.quantity) || 1), 0) * 2.45).toFixed(1)} kg</strong><span>CO₂ diverted</span></div>
        </div>
        <button type="button" class="user-impact-share-btn" id="share-my-impact-btn">Share My Eco-Impact ↗</button>
      </div>
    ` : ''}
    <div class="my-pickups-list">
      ${pickups.length ? pickups.map((ticket) => `
        <article class="pickup-ticket-item">
          <div class="ticket-top">
            <div>
              <span class="ticket-shop">${escapeHTML(ticket.shop)}</span>
              <h4 class="ticket-title">${escapeHTML(ticket.title)}</h4>
            </div>
            <span class="demo-badge">${ticket.demo ? 'Demo' : 'PayPal'}</span>
          </div>
          <div class="ticket-qr-row">
            <div class="ticket-qr-wrap">${renderQRCodeSVG(ticket.pickupCode, 110)}</div>
            <div class="ticket-info-wrap">
              <div class="ticket-code-label">PICKUP CODE</div>
              <div class="ticket-code-text">${escapeHTML(ticket.pickupCode)}</div>
              <div class="ticket-meta-line"><span>Pick up by</span> <b>${escapeHTML(ticket.pickupBy)}</b></div>
              <div class="ticket-meta-line"><span>Location</span> <b>${escapeHTML(ticket.address)}</b></div>
              <div class="ticket-meta-line"><span>Qty</span> <b>${ticket.quantity} bundle${ticket.quantity === 1 ? '' : 's'} (${money(ticket.price)})</b></div>
            </div>
          </div>
        </article>
      `).join('') : `
        <div class="empty-state" style="padding:40px 10px;">
          <div>🎟️</div>
          <h3>No active passes</h3>
          <p>When you reserve or buy a surplus bundle, your ticket and QR code will be saved right here.</p>
        </div>
      `}
    </div>
  `;
  openDrawer();
  document.querySelector('#share-my-impact-btn')?.addEventListener('click', async () => {
    const totalMeals = pickups.reduce((acc, t) => acc + (Number(t.quantity) || 1), 0);
    const co2 = (totalMeals * 2.45).toFixed(1);
    const text = `I've rescued ${totalMeals} meals and kept ${co2} kg of CO₂ out of landfills using LastPlate! 🌱`;
    try {
      if (navigator.share) await navigator.share({ title: 'My LastPlate Impact', text, url: window.location.origin });
      else {
        await navigator.clipboard.writeText(text + ' ' + window.location.origin);
        notify('Your eco-impact badge copied to clipboard!');
      }
    } catch (e) {
      if (e.name !== 'AbortError') notify('Impact badge copied to clipboard!');
    }
  });
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
    const totalRecovered = orders.filter(o => o.status === 'picked_up' || o.status === 'paid' || o.status === 'reserved')
      .reduce((acc, o) => acc + Number(o.total || 0), 0) + (listings.length ? 148.00 : 0);
    const totalDivertedMeals = orders.reduce((acc, o) => acc + Number(o.quantity || 1), 0) + (listings.length ? 19 : 0);

    drawerContent.innerHTML = `<section class="seller-dashboard">
      <div class="seller-dashboard-head"><div><div class="eyebrow"><span class="eyebrow-dot"></span> SHOP DASHBOARD</div><h2>${escapeHTML(user?.name || 'Your shop')}</h2><p>${activeCount} active listing${activeCount === 1 ? '' : 's'} • ${pendingCount} pending pickup${pendingCount === 1 ? '' : 's'}</p></div>
        <div class="seller-dashboard-actions">
          <button id="dashboard-add-listing" type="button">＋ Add listing</button>
          <a href="/flyer.html" target="_blank" rel="noopener" class="seller-kit-btn" title="Print Counter Table Tent & Kit">📄 Counter Kit</a>
          <button id="seller-logout" type="button">Sign out</button>
        </div>
      </div>

      <div class="seller-revenue-card">
        <div class="seller-revenue-head">
          <span class="revenue-icon">💰</span>
          <div>
            <h4>Weekly Revenue & Waste Diverted</h4>
            <p>Your closing-time surplus value recovered:</p>
          </div>
        </div>
        <div class="seller-revenue-grid">
          <div class="revenue-stat-box"><strong>${money(totalRecovered)}</strong><span>Recovered revenue</span></div>
          <div class="revenue-stat-box"><strong>${totalDivertedMeals}</strong><span>Meals rescued</span></div>
          <div class="revenue-stat-box"><strong>100%</strong><span>On-time pickup rate</span></div>
        </div>
      </div>

      <div class="seller-verify-card">
        <div class="seller-verify-head">
          <div class="seller-verify-title-row">
            <h4>Counter Pickup Verification</h4>
            <button type="button" class="button-scanner-action" id="scan-qr-btn">
              📷 <span>Scan Camera Pass</span>
            </button>
          </div>
          <p>Scan buyer's QR code pass or enter their 4-digit code to complete hand-off:</p>
        </div>
        <form id="seller-verify-form" class="seller-verify-form">
          <input id="verify-input" class="form-control" placeholder="Enter code, e.g. LP-NDNJA" maxlength="16" autocomplete="off" required>
          <button class="button button-dark" type="submit" id="verify-submit">Verify <span>✓</span></button>
        </form>
        <div id="verify-feedback" class="verify-feedback hidden"></div>
      </div>

      <section class="seller-dashboard-section"><h3>Your listings</h3><div class="seller-dashboard-list">${listings.length ? listings.map((listing) => `<article class="seller-dashboard-item"><div><h4>${escapeHTML(listing.title)}</h4><p>${escapeHTML(listing.category)} · ${escapeHTML(listing.pickupBy)} · ${escapeHTML(listing.address)}</p></div><div class="seller-item-actions"><button type="button" data-listing-${listing.status === 'active' ? 'deactivate' : 'activate'}="${listing.id}">${listing.status === 'active' ? 'Mark sold out' : 'Reopen listing'}</button></div></article>`).join('') : '<div class="seller-empty">No listings yet. Add one to put surplus on the menu.</div>'}</div></section>
      <section class="seller-dashboard-section"><h3>Pickup orders</h3><div class="seller-dashboard-list">${orders.length ? orders.map((order) => `<article class="seller-dashboard-item"><div><h4>${escapeHTML(order.title || order.listingTitle || 'Pickup order')}</h4><p><span class="seller-order-code">${escapeHTML(order.pickupCode || '—')}</span> · ${escapeHTML(order.status)} · ${money(order.total || 0)}</p></div><div class="seller-order-actions"><button type="button" data-order-picked-up="${order.id}" ${order.status === 'picked_up' ? 'disabled' : ''}>Mark picked up</button><button type="button" data-order-cancel="${order.id}" ${order.status === 'cancelled' ? 'disabled' : ''}>Cancel</button></div></article>`).join('') : '<div class="seller-empty">No pickup orders yet.</div>'}</div></section>
    </section>`;
    openDrawer();
    document.querySelector('#dashboard-add-listing').addEventListener('click', () => openListingForm(user));
    document.querySelector('#seller-logout').addEventListener('click', async () => {
      try {
        await api('/api/auth/logout', undefined, 'POST');
        showSellerAuth('login');
      } catch (error) { notify(error.message); }
    });

    const scanQrBtn = document.querySelector('#scan-qr-btn');
    if (scanQrBtn) {
      scanQrBtn.addEventListener('click', () => {
        startCameraScanner(async (code) => {
          notify(`Detected QR pass: ${code}`);
          const input = document.querySelector('#verify-input');
          if (input) input.value = code;
          const verifyForm = document.querySelector('#seller-verify-form');
          if (verifyForm) verifyForm.requestSubmit();
        });
      });
    }

    const verifyForm = document.querySelector('#seller-verify-form');
    if (verifyForm) {
      verifyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.querySelector('#verify-input');
        const feedback = document.querySelector('#verify-feedback');
        const submitBtn = document.querySelector('#verify-submit');
        const code = input.value.trim().toUpperCase();
        if (!code) return;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Verifying…';
        feedback.className = 'verify-feedback hidden';
        try {
          const res = await api('/api/seller/orders/verify', { pickupCode: code });
          playSuccessBeep();
          confetti();
          feedback.className = 'verify-feedback success';
          feedback.innerHTML = `<b>✓ Verified:</b> ${escapeHTML(res.message)}`;
          input.value = '';
          notify('Pickup verified successfully!');
          setTimeout(() => renderSellerDashboard(user), 1600);
        } catch (err) {
          feedback.className = 'verify-feedback error';
          feedback.innerHTML = `<b>✕ Not Verified:</b> ${escapeHTML(err.message)}`;
        } finally {
          submitBtn.disabled = false;
          submitBtn.innerHTML = 'Verify <span>✓</span>';
        }
      });
    }

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
    results.innerHTML = `<p>${escapeHTML(data.message)}${state.recommendations.length ? ` <b>${state.recommendations.length} match${state.recommendations.length === 1 ? '' : 'es'} below.</b>` : ''}</p>`;
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
function renderAboutUs() {
  state.selected = null;
  drawerContent.innerHTML = `
    <div class="about-drawer-head">
      <img src="/images/logo.png" alt="LastPlate" style="max-height: 84px; width: auto; display: block; margin: 0 0 16px;">
      <div class="eyebrow"><span class="eyebrow-dot"></span> OUR STORY & MISSION</div>
      <h2 id="drawer-title">Good food deserves another day.</h2>
      <p class="about-tagline">LastPlate is a neighborhood food rescue platform connecting hungry locals with beloved bakeries and cafés before closing time.</p>
    </div>

    <div class="about-hero-card">
      <div class="about-stat-row">
        <div class="about-stat"><strong>1,480+</strong><span>Meals rescued</span></div>
        <div class="about-stat"><strong>3.2 t</strong><span>CO₂ prevented</span></div>
        <div class="about-stat"><strong>$18k+</strong><span>Saved by locals</span></div>
      </div>
    </div>

    <div class="about-section">
      <h3>Why we started LastPlate</h3>
      <p>Every single evening across Toronto, bakers and café cooks pull delicious sourdough loaves, butter croissants, sandwiches, and salads off the shelves simply because tomorrow needs a fresh kind of attention.</p>
      <p>Meanwhile, food costs keep rising. We built LastPlate to make rescue as easy as picking up an afternoon snack: shops list their extra bundles in 2 minutes, and neighbors collect them at a fair price instead of letting good food go to waste.</p>
    </div>

    <div class="about-values">
      <div class="about-value-item">
        <span class="value-icon">🥐</span>
        <div>
          <h4>Made fresh today</h4>
          <p>Every bundle was prepared that morning or afternoon by the local shop you already know.</p>
        </div>
      </div>
      <div class="about-value-item">
        <span class="value-icon">🌱</span>
        <div>
          <h4>Real climate impact</h4>
          <p>Food waste accounts for 8% of global greenhouse emissions. Every plate rescued keeps organic matter out of landfills.</p>
        </div>
      </div>
      <div class="about-value-item">
        <span class="value-icon">🤝</span>
        <div>
          <h4>100% locally owned</h4>
          <p>We support independent neighborhood bakeries, family-run delis, and sustainable cafés.</p>
        </div>
      </div>
    </div>

    <div class="about-contact-card">
      <h4>Have a favorite bakery or question?</h4>
      <p>We’d love to hear from you or help your favorite neighborhood spot join LastPlate.</p>
      <a href="mailto:hello@lastplate.local" class="button button-dark" style="width:100%; justify-content:center; margin-top:10px;">Say hello <span>✉</span></a>
    </div>
  `;
  openDrawer();
}

document.querySelectorAll('.prompt-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const query = chip.dataset.query;
    const input = document.querySelector('#ai-query');
    if (input && query) {
      input.value = query;
      document.querySelector('#ai-search-form')?.requestSubmit();
    }
  });
});

document.querySelector('#open-seller').addEventListener('click', openSeller);
document.querySelector('#open-seller-lower').addEventListener('click', openSeller);
document.querySelector('#open-my-pickups')?.addEventListener('click', renderMyPickups);
document.querySelector('#open-about')?.addEventListener('click', (e) => {
  e.preventDefault();
  history.pushState(null, '', '#about');
  renderAboutUs();
});
document.querySelector('#close-drawer').addEventListener('click', closeDrawer);
overlay.addEventListener('click', (event) => { if (event.target === overlay) closeDrawer(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && overlay.classList.contains('open')) closeDrawer(); });

document.addEventListener('click', (event) => {
  const locationPicker = document.querySelector('#location-picker');
  if (!locationPicker) return;
  if (!locationPicker.contains(event.target)) toggleLocationMenu(false);
});

document.querySelector('#location-pill-button')?.addEventListener('click', (event) => {
  event.stopPropagation();
  const menu = document.querySelector('#location-menu');
  if (!menu) return;
  menu.classList.toggle('hidden');
  document.querySelector('#location-pill-button').setAttribute('aria-expanded', menu.classList.contains('hidden') ? 'false' : 'true');
});
document.querySelector('#use-location-btn')?.addEventListener('click', requestUserLocation);
document.querySelector('#postal-code-btn')?.addEventListener('click', applyPostalCodeLocation);
document.querySelector('#clear-location-btn')?.addEventListener('click', clearLocation);
document.querySelector('#postal-code-input')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); applyPostalCodeLocation(); }
});

window.addEventListener('hashchange', () => {
  if (window.location.hash === '#about') renderAboutUs();
  else if (window.location.hash === '#mypickups') renderMyPickups();
});

async function init() {
  try {
    loadUserLocation();
    updateLocationPill();
    state.config = await api('/api/config');
    if (!state.config.aiConfigured) document.querySelector('.ai-discovery-copy span').textContent = 'Preview only: add an OpenAI API key to enable live matching.';
    updatePickupsBadge();
    updateFavoritesBadge();
    await refreshListings();
    checkActiveDropAlerts();
    if (window.location.hash === '#about') renderAboutUs();
  } catch (error) { notify(error.message); }
}

init();


/* --- View Switcher (Grid vs Map) --- */
const gridBtn = document.querySelector('#view-grid-btn');
const mapBtn = document.querySelector('#view-map-btn');
if (gridBtn && mapBtn) {
  gridBtn.addEventListener('click', () => {
    state.view = 'grid';
    gridBtn.classList.add('active');
    mapBtn.classList.remove('active');
    renderListings();
  });
  mapBtn.addEventListener('click', () => {
    state.view = 'map';
    mapBtn.classList.add('active');
    gridBtn.classList.remove('active');
    renderListings();
  });
}

/* --- Dietary Preferences Filter --- */
document.querySelectorAll('.dietary-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.dietary-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    state.dietary = pill.dataset.dietary;
    renderListings();
  });
});

/* --- Camera Scanner Modal Dismissals --- */
document.querySelector('#close-camera-btn')?.addEventListener('click', stopCameraScanner);
document.querySelector('#camera-cancel-btn')?.addEventListener('click', stopCameraScanner);
document.querySelector('#close-camera-backdrop')?.addEventListener('click', stopCameraScanner);

/* --- Live Countdown Timer Interval (Every 30 seconds) --- */
setInterval(() => {
  if (state.view === 'grid') renderListings();
}, 30000);

