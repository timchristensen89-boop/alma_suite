// Read-only sandbox probe: token + Directory API only. Prints statuses, scope,
// counts and public listing fields. Never prints credentials or the token.
const id = process.env.OPENTABLE_DIRECTORY_CLIENT_ID || process.env.OPENTABLE_CLIENT_ID;
const secret = process.env.OPENTABLE_DIRECTORY_CLIENT_SECRET || process.env.OPENTABLE_CLIENT_SECRET;
if (!id || !secret) { console.log('no sandbox credentials in env'); process.exit(1); }
const OAUTH = 'https://oauth-pp.opentable.com';
const API = 'https://platform.otqa.com';
const basic = Buffer.from(`${id}:${secret}`).toString('base64');
const out = (label, value) => console.log(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);

// 1. token (documented: POST with Content-Length 0; the website client uses GET — try both)
let token = null;
for (const method of ['POST', 'GET']) {
  const res = await fetch(`${OAUTH}/api/v2/oauth/token?grant_type=client_credentials`, { method, headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json', ...(method === 'POST' ? { 'Content-Length': '0' } : {}) } });
  const body = await res.json().catch(() => ({}));
  out(`token ${method}`, { status: res.status, token_type: body.token_type, scope: body.scope, expires_in: body.expires_in, has_token: Boolean(body.access_token) });
  if (res.ok && body.access_token && !token) token = body.access_token;
}
if (!token) process.exit(2);
const H = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
const pick = (r) => ({ rid: r.rid, name: r.name, city: r.city, state: r.state, country: r.country, is_restaurant_in_group: r.is_restaurant_in_group, natural_reservation_url: r.natural_reservation_url, reservation_url: r.reservation_url, phone_number: r.phone_number, review_count: r.review_count, aggregate_score: r.aggregate_score, category: r.category, price_quartile: r.price_quartile, hours_raw: r.hours_raw, private_dining: r.private_dining, photo: r.profile_photo && Object.keys(r.profile_photo).length ? 'present' : 'none' });

// 2. rid filter
for (const rid of ['211301', '211307', '264001']) {
  const res = await fetch(`${API}/sync/directory?rid=${rid}`, { headers: H });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 120); }
  out(`directory?rid=${rid}`, { status: res.status, ot_requestid: res.headers.get('ot-requestid'), total_items: body?.total_items, items: body?.items?.length, error: body?.errors?.[0]?.message ?? (typeof body === 'string' ? body : undefined) });
  if (body?.items?.length) out('  item', pick(body.items[0]));
}
// 3. country scan for the two venues
let offset = 0, found = [], total = null, pages = 0;
while (pages < 10) {
  const res = await fetch(`${API}/sync/directory?country=AU&offset=${offset}&limit=1000`, { headers: H });
  if (!res.ok) { out('country=AU', { status: res.status }); break; }
  const body = await res.json();
  total = body.total_items; pages += 1;
  for (const r of body.items ?? []) if (['211301', '211307'].includes(String(r.rid))) found.push(pick(r));
  offset += body.items?.length ?? 0;
  if (!body.items?.length || offset >= total) break;
}
out('country=AU', { total_items: total, pages, found: found.length });
for (const r of found) out('  venue', r);
// 4. documented-but-unsubscribed probe: Sync API & Consumer API are NOT called (not authorised under Directory Bronze).
out('skipped', 'availability/lock/reserve (Consumer API) and /sync/reservations (Sync API): not part of the Directory (Bronze) subscription; not called');
