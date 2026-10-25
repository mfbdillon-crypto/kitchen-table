window.ktDeploy = async function (sha, title, siteId) {
  siteId = siteId || '5236eb56-b402-43c4-a92f-1aac62cc691d';
  if (!window.__nt) { const ses = JSON.parse(localStorage.getItem('nf-session') || '{}'); window.__nt = ses.access_token || ''; }
  const H = { Authorization: 'Bearer ' + window.__nt }; const B = '/access-control/bb-api/api/v1';
  const FILES = ['index.html', 'style.css', 'qrcode.js', 'config.js', 'cards.js', 'effects.js', 'oracle.js', 'rulebook.js', 'rules.js', 'engine.js', 'net.js', 'scry.js', 'game.js', 'phone.js', 'precons.js', 'ui.js', 'aiprofiles.js', 'aiface.js', 'aibrain.js', 'aiexec.js', 'ai.js'];
  const enc = new TextEncoder(); const body = {}; const files = {};
  const hex = async buf => [...new Uint8Array(await crypto.subtle.digest('SHA-1', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
  for (const f of FILES) {
    const r = await fetch(`https://raw.githubusercontent.com/mfbdillon-crypto/kitchen-table/${sha}/site/${f}`);
    if (!r.ok) throw new Error('fetch ' + f + ' ' + r.status);
    const buf = await r.arrayBuffer(); body['/' + f] = buf; files['/' + f] = await hex(buf);
  }
  const ver = enc.encode(`${title}\n${sha}\n`); body['/version.txt'] = ver; files['/version.txt'] = await hex(ver);
  const site = await (await fetch(`${B}/sites/${siteId}`, { headers: H })).json();
  const cur = await (await fetch(`${B}/deploys/${site.published_deploy.id}`, { headers: H })).json();
  const functions = {}; for (const fn of cur.available_functions || []) functions[fn.n] = fn.d;
  const dep = await (await fetch(`${B}/sites/${siteId}/deploys`, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, H), body: JSON.stringify({ files, functions, title, async: false }) })).json();
  if (!dep.id) throw new Error('deploy create failed: ' + JSON.stringify(dep).slice(0, 300));
  const req = dep.required || [];
  for (const [p, h] of Object.entries(files)) if (req.includes(h)) { const r = await fetch(`${B}/deploys/${dep.id}/files${p}`, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, H), body: body[p] }); if (!r.ok) throw new Error('upload ' + p + ' ' + r.status); }
  let st = dep;
  for (let i = 0; i < 60 && st.state !== 'ready' && st.state !== 'error'; i++) { await new Promise(r => setTimeout(r, 2000)); st = await (await fetch(`${B}/deploys/${dep.id}`, { headers: H })).json(); }
  return { id: dep.id, state: st.state, required: req.length, reqFns: dep.required_functions || [], fns: Object.keys(functions), url: st.deploy_ssl_url || st.deploy_url };
};
'ok';
