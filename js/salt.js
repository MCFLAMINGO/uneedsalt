/* Salt — host helper. Three lines:
 *   var rec = await Salt.yes({ who: 'cursor', action: 'pay', to: 'Railway', amount: '12' });
 *   if (!rec) throw new Error('no human yes');
 * Fail closed. The yes is a packet that pops — not a page, not a modal.
 */
(function (w) {
  'use strict';
  if (!w) return;
  var doc = w.document;

  /** Always the Salt origin — like Stripe.js always talks to Stripe, not the shop. */
  function apiBase() {
    try { if (w.SALT_API) return String(w.SALT_API).replace(/\/$/, ''); } catch (e) { /* ignore */ }
    try {
      var h = w.location && w.location.hostname;
      if (h === 'localhost' || h === '127.0.0.1') {
        var p = w.location && w.location.port;
        if (p && p !== '3000' && p !== '3010') return String(w.location.origin).replace(/\/$/, '');
        return 'http://127.0.0.1:8787';
      }
    } catch (e) { /* ignore */ }
    return 'https://uneedsalt.com';
  }

  function assetBase() {
    try { if (w.SALT_ASSETS) return String(w.SALT_ASSETS).replace(/\/$/, ''); } catch (e) { /* ignore */ }
    try {
      var h = w.location && w.location.hostname;
      if (h === 'localhost' || h === '127.0.0.1') {
        var p = w.location && w.location.port;
        if (p && p !== '3000' && p !== '3010') return String(w.location.origin).replace(/\/$/, '');
        return 'http://127.0.0.1:3000';
      }
    } catch (e) { /* ignore */ }
    return 'https://uneedsalt.com';
  }

  function hostKey(spec) {
    try {
      if (spec && spec.key) return String(spec.key);
      if (w.SALT_KEY) return String(w.SALT_KEY);
      if (w.Salt && w.Salt.key) return String(w.Salt.key);
    } catch (e) { /* ignore */ }
    return '';
  }

  function j(method, path, body, spec) {
    var opt = { method: method, headers: { Accept: 'application/json' }, mode: 'cors' };
    var k = hostKey(spec);
    if (k) opt.headers.Authorization = 'Bearer ' + k;
    if (body) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    return fetch(apiBase() + path, opt).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok && !j) throw new Error('Salt ' + r.status);
        return j;
      });
    });
  }

  function sleep(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  function wellKnown() { return j('GET', '/api/salt'); }
  function challenge(spec) { return j('POST', '/api/salt/challenge', spec || {}, spec); }
  function poll(id) { return j('GET', '/api/salt/challenge/' + encodeURIComponent(id)); }
  function yesTap(id) { return j('POST', '/api/salt/challenge/' + encodeURIComponent(id) + '/yes'); }
  function noTap(id) { return j('POST', '/api/salt/challenge/' + encodeURIComponent(id) + '/no'); }
  function verify(receipt) { return j('POST', '/api/salt/verify', { receipt: receipt }); }

  function ensureCss() {
    if (!doc || doc.getElementById('salt-css')) return;
    var l = doc.createElement('link');
    l.id = 'salt-css';
    l.rel = 'stylesheet';
    l.href = assetBase() + '/css/salt.css';
    (doc.head || doc.documentElement).appendChild(l);
  }

  function label(el, c) {
    if (!el || !c) return;
    var who = el.querySelector('.salt-who');
    var act = el.querySelector('.salt-act');
    var to = el.querySelector('.salt-to');
    if (who) who.textContent = (c.who || 'agent') + ' wants to';
    var a = c.action || 'act';
    var amt = [c.amount, c.unit].filter(Boolean).join(' ');
    if (act) act.textContent = amt ? (a + ' ' + amt) : a;
    if (to) to.textContent = c.to ? ('→ ' + c.to) : '';
  }

  function finish(pkt, ok, text) {
    if (!pkt) return;
    var y = pkt.querySelector('.salt-yes');
    var n = pkt.querySelector('.salt-no');
    if (y) y.disabled = true;
    if (n) n.disabled = true;
    var d = pkt.querySelector('.salt-done');
    if (d) {
      d.hidden = false;
      d.className = 'salt-done ' + (ok ? 'ok' : 'bad');
      d.textContent = text;
    }
    pkt.classList.add('is-open');
    pkt.classList.add(ok ? 'is-yes' : 'is-no');
  }

  function packetEl(c) {
    var pkt = doc.createElement('div');
    pkt.className = 'salt-pkt';
    pkt.setAttribute('data-salt', c && c.id ? c.id : '');
    pkt.innerHTML =
      '<div class="salt-sheet">' +
      '<div class="salt-crimp" aria-hidden="true"></div>' +
      '<button type="button" class="salt-face" aria-expanded="false" aria-label="Salt — open">' +
      '<span class="salt-word">Salt</span></button>' +
      '<div class="salt-in">' +
      '<div class="salt-who"></div><div class="salt-act"></div><div class="salt-to"></div>' +
      '<div class="salt-row">' +
      '<button type="button" class="salt-yes">Yes</button>' +
      '<button type="button" class="salt-no">No</button></div>' +
      '<p class="salt-done" hidden></p></div></div>';
    label(pkt, c || {});
    var face = pkt.querySelector('.salt-face');
    face.onclick = function () {
      var open = pkt.classList.toggle('is-open');
      face.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    return pkt;
  }

  function bindDecide(pkt, id) {
    pkt.querySelector('.salt-yes').onclick = function (e) {
      e.stopPropagation();
      yesTap(id).then(function () { finish(pkt, true, 'Yes — they can go.'); })
        .catch(function (err) { finish(pkt, false, (err && err.message) || 'Failed.'); });
    };
    pkt.querySelector('.salt-no').onclick = function (e) {
      e.stopPropagation();
      noTap(id).then(function () { finish(pkt, false, 'No — it stopped.'); })
        .catch(function (err) { finish(pkt, false, (err && err.message) || 'Failed.'); });
    };
  }

  /** Drop a packet on this page. Click it for details. Not a modal. */
  function pop(c, opts) {
    if (!doc || !doc.body) return null;
    ensureCss();
    var o = opts || {};
    var host = o.host;
    if (!host) {
      host = doc.getElementById('salt-float');
      if (!host) {
        host = doc.createElement('div');
        host.id = 'salt-float';
        host.className = 'salt-float';
        doc.body.appendChild(host);
      }
    }
    host.innerHTML = '';
    var pkt = packetEl(c);
    var knock = !!(o.knock || (host && host.id === 'salt-stage') || (doc.body && doc.body.classList.contains('salt-knock')));
    if (knock) pkt.classList.add('salt-pkt--knock');
    host.appendChild(pkt);
    if (c && c.id) bindDecide(pkt, c.id);
    if (knock && c && c.status === 'pending') {
      setTimeout(function () {
        pkt.classList.add('is-open');
        var face = pkt.querySelector('.salt-face');
        if (face) face.setAttribute('aria-expanded', 'true');
      }, 280);
    }
    if (c && (c.status === 'yes' || c.status === 'no' || c.status === 'expired')) {
      finish(pkt, c.status === 'yes',
        c.status === 'yes' ? 'Yes — they can go.' :
        c.status === 'no' ? 'No — it stopped.' : 'Too late.');
    }
    return pkt;
  }

  /**
   * Host call: create a challenge, pop a packet, wait for the tap, return receipt or null.
   */
  async function yes(spec, opts) {
    var o = opts || {};
    var ch = await challenge(spec);
    if (typeof o.onChallenge === 'function') o.onChallenge(ch);
    if (o.openTap !== false && doc && doc.body) {
      pop(ch, o);
    } else if (o.openTap !== false && w.open && ch && ch.tap) {
      try { w.open(ch.tap, 'salt-tap', 'width=240,height=200,noopener'); } catch (e) { /* blocked */ }
    }
    var until = Date.now() + (o.timeoutMs || 95000);
    while (Date.now() < until) {
      var cur = await poll(ch.id);
      if (cur.status === 'yes') return cur.receipt || null;
      if (cur.status === 'no' || cur.status === 'expired') return null;
      await sleep(o.intervalMs || 800);
    }
    return null;
  }

  w.Salt = {
    apiBase: apiBase,
    wellKnown: wellKnown,
    challenge: challenge,
    poll: poll,
    yesTap: yesTap,
    noTap: noTap,
    verify: verify,
    pop: pop,
    yes: yes,
  };
})(typeof window !== 'undefined' ? window : this);
