// _shared/iff-api.js — single API client for all 5 IFF portals
// Uses the same Worker base for every portal.
// Token persisted in localStorage; ApiKey fallback supported via env.

const DEFAULT_API = "https://api.cantekhi.com";

export class IFFApi {
  constructor({ base, token, apiKey } = {}) {
    this.base = base || (typeof window !== 'undefined' && window.IFF_API_BASE) || DEFAULT_API;
    this.token = token || (typeof localStorage !== 'undefined' ? localStorage.getItem('iff_token') : null);
    this.apiKey = apiKey || (typeof window !== 'undefined' ? window.IFF_API_KEY : null);
  }
  setToken(t) { this.token = t; if (typeof localStorage !== 'undefined') localStorage.setItem('iff_token', t); }
  clearToken() { this.token = null; if (typeof localStorage !== 'undefined') localStorage.removeItem('iff_token'); }

  async _fetch(path, opts = {}) {
    const headers = new Headers(opts.headers || {});
    headers.set('Content-Type', 'application/json');
    if (this.token)  headers.set('Authorization', `Bearer ${this.token}`);
    if (this.apiKey) headers.set('X-Api-Key', this.apiKey);
    const res = await fetch(`${this.base}${path}`, { ...opts, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`IFF API ${res.status}: ${text}`);
    }
    if (res.headers.get('content-type')?.includes('application/json')) return res.json();
    return res.text();
  }

  // --- Signals ---
  signals(filter = {}) {
    const q = new URLSearchParams(filter).toString();
    return this._fetch(`/v1/signals${q ? '?' + q : ''}`);
  }
  signal(id) { return this._fetch(`/v1/signals/${id}`); }
  recomputeSignals() { return this._fetch('/v1/signals/recompute', { method: 'POST' }); }

  // --- Lots ---
  listLots(filter = {}) {
    const q = new URLSearchParams(filter).toString();
    return this._fetch(`/v1/lots${q ? '?' + q : ''}`);
  }
  createLot(body) { return this._fetch('/v1/lots', { method: 'POST', body: JSON.stringify(body) }); }
  patchLot(id, body) { return this._fetch(`/v1/lots/${id}`, { method: 'PATCH', body: JSON.stringify(body) }); }

  // --- Auctions ---
  listAuctions(filter = {}) {
    const q = new URLSearchParams(filter).toString();
    return this._fetch(`/v1/auctions${q ? '?' + q : ''}`);
  }
  createAuction(body) { return this._fetch('/v1/auctions', { method: 'POST', body: JSON.stringify(body) }); }

  connectAuction(auctionId, { onMessage, onClose, onError } = {}) {
    const proto = this.base.replace(/^https/, 'wss').replace(/^http/, 'ws');
    const ws = new WebSocket(`${proto}/ws/auction/${auctionId}${this.token ? '?token=' + encodeURIComponent(this.token) : ''}`);
    ws.addEventListener('message', e => onMessage && onMessage(JSON.parse(e.data)));
    ws.addEventListener('close', e => onClose && onClose(e));
    ws.addEventListener('error', e => onError && onError(e));
    ws.placeBid = (price, qty) => ws.send(JSON.stringify({ type: 'bid', price, quantity_kg: qty }));
    return ws;
  }

  // --- Traceability ---
  appendEvent(body) { return this._fetch('/v1/trace/events', { method: 'POST', body: JSON.stringify(body) }); }
  getLotChain(lotId) { return this._fetch(`/v1/trace/lot/${lotId}`); }

  // --- Settlements ---
  settlements(filter = {}) {
    const q = new URLSearchParams(filter).toString();
    return this._fetch(`/v1/settlements${q ? '?' + q : ''}`);
  }

  // --- Research ---
  researchScans(filter = {}) {
    const q = new URLSearchParams(filter).toString();
    return this._fetch(`/v1/research/scans${q ? '?' + q : ''}`);
  }
  newResearchScan(topic) { return this._fetch('/v1/research/scans', { method: 'POST', body: JSON.stringify({ topic }) }); }

  // --- Public (no auth) ---
  publicTrace(lotId) { return this._fetch(`/public/trace/${lotId}`); }
  publicSignals() { return this._fetch('/public/signals/highlights'); }
}

// Auto-instantiate global if loaded as classic script
if (typeof window !== 'undefined') {
  window.IFFApi = IFFApi;
  window.iff = new IFFApi();
}
