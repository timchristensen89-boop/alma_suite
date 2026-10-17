// Mock of the two free OpenTable APIs + OAuth, for local dashboard screenshots.
// Shapes follow docs.opentable.com (read 16 Oct 2026). Nothing here is real.
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 3999);
const stored = new Map(); // rid -> last menus payload
let requestCounter = 132658925;

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
  });
}

/** Turn the submitted envelope into the documented GET shape, nudging one price so the comparison has something to show. */
function toRemote(rid) {
  const payload = stored.get(rid);
  if (!payload) return { rid: Number(rid), menus: [] };
  const element = payload.menus[0] ?? {};
  const menuIds = Object.keys(element).filter((key) => key.startsWith('alma-menu-'));
  return {
    rid: Number(rid),
    menus: menuIds.map((menuId) => {
      const menu = element[menuId];
      const groupIds = menu.groups.map((ref) => ref.id);
      const itemIds = groupIds.flatMap((groupId) => (element.groups[groupId]?.items ?? []).map((ref) => ref.id));
      let nudged = false;
      return {
        menu: { id: menuId, name: menu.name, description: menu.description, currency: menu.defaultCurrency, updatedAt: menu.updatedAt, ordinal: menu.ordinal, groups: groupIds },
        groups: groupIds.map((groupId) => ({ id: groupId, name: element.groups[groupId].name, ordinal: element.groups[groupId].ordinal, items: (element.groups[groupId].items ?? []).map((ref) => ref.id) })),
        items: itemIds.map((itemId) => {
          const item = element.items[itemId];
          const price = item.priceMetadata?.priceType === 'PRICE' ? item.priceMetadata.minPrice : undefined;
          const amount = price !== undefined && !nudged ? ((nudged = true), price + 1) : price;
          return { id: itemId, name: item.name, description: item.description, ordinal: item.ordinal, price: amount !== undefined ? { amount } : undefined, tags: item.metadata?.dietaryTags ?? [], modifierGroups: [] };
        }),
        modifierGroups: [],
        modifiers: []
      };
    })
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const auth = req.headers.authorization ?? '';
  console.log(`${new Date().toISOString()} ${req.method} ${url.pathname}${url.search} x-request-id=${req.headers['x-request-id'] ?? '-'}`);

  if (req.method === 'POST' && url.pathname === '/api/v2/oauth/token') {
    if (!auth.startsWith('Basic ')) return send(res, 401, { error: 'invalid_client' });
    const [id, secret] = Buffer.from(auth.slice(6), 'base64').toString('utf8').split(':');
    if (secret === 'wrong') return send(res, 401, { error: 'invalid_client', error_description: 'Client authentication failed' });
    return send(res, 200, { access_token: `mock-${id}-${Date.now()}`, scope: 'DEFAULT', token_type: 'Bearer', expires_in: 3600 });
  }
  if (!auth.startsWith('Bearer mock-')) return send(res, 401, { message: 'Unauthorized' });

  let match;
  if (req.method === 'POST' && (match = url.pathname.match(/^\/v1\/partnermenu\/([^/]+)\/location\/(\d+)\/menus$/))) {
    const rid = match[2];
    const body = JSON.parse((await readBody(req)) || '{}');
    if (process.env.MOCK_FAIL === 'menus') return send(res, 503, { message: 'upstream unavailable' });
    stored.set(rid, body);
    const element = body.menus?.[0] ?? {};
    const itemIds = Object.keys(element.items ?? {});
    const processed = process.env.MOCK_PARTIAL === '1' ? Math.max(0, itemIds.length - 1) : itemIds.length;
    return send(res, 200, {
      requestId: requestCounter++,
      itemStatus: itemIds.map((itemId, index) => ({ itemId, sequenceId: String(index + 1), status: index < processed ? 'Processing' : 'Failed', ...(index < processed ? {} : { message: 'price must be positive' }) })),
      totalItems: itemIds.length,
      totalProcessedItems: processed,
      created: new Date().toISOString()
    });
  }
  if (req.method === 'GET' && (match = url.pathname.match(/^\/v1\/menus\/rid\/(\d+)$/))) {
    return send(res, 200, toRemote(match[1]));
  }
  if (req.method === 'POST' && (match = url.pathname.match(/^\/v2\/partnerrestaurants\/rid\/(\d+)$/))) {
    const body = JSON.parse((await readBody(req)) || '{}');
    const fields = Object.keys(body).filter((key) => key !== 'id');
    return send(res, 200, { requestId: requestCounter++, itemStatus: [{ itemId: match[1], sequenceId: '1', status: 'Processing' }], totalItems: fields.length, totalProcessedItems: fields.length, created: new Date().toISOString() });
  }
  send(res, 404, { message: `No such endpoint: ${req.method} ${url.pathname}` });
});

server.listen(PORT, () => console.log(`mock OpenTable listening on http://localhost:${PORT}`));
