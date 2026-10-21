// Reads a public Moxfield deck for Kitchen Table (Moxfield doesn't let browsers read decks from other sites).
exports.handler = async (event) => {
  const id = ((event.queryStringParameters || {}).id || '').trim();
  const json = (code, body) => ({ statusCode: code, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': code === 200 ? 'public, max-age=300' : 'no-store' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return json(400, { error: 'That is not a Moxfield deck id.' });
  const urls = ['https://api2.moxfield.com/v3/decks/all/' + id, 'https://api2.moxfield.com/v2/decks/all/' + id];
  let last = 502;
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'KitchenTable/1.0 (personal deck import)', Accept: 'application/json' } });
      last = r.status;
      if (r.ok) return json(200, await r.text());
      if (r.status === 404) return json(404, { error: 'Moxfield says that deck does not exist or is private.' });
    } catch (e) { last = 502; }
  }
  return json(last, { error: 'Moxfield did not answer (status ' + last + ').' });
};
