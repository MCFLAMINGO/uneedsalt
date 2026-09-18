(function () {
  'use strict';
  function api() {
    try { if (window.SALT_API) return String(window.SALT_API).replace(/\/$/, ''); } catch (e) { /* ignore */ }
    try {
      var h = location.hostname;
      var p = String(location.port || '');
      if ((h === 'localhost' || h === '127.0.0.1') && (p === '3000' || p === '3010')) return 'http://127.0.0.1:8787';
    } catch (e) { /* ignore */ }
    return '';
  }
  function j(method, path, body) {
    var opt = { method: method, headers: { Accept: 'application/json' } };
    if (body) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    return fetch(api() + path, opt).then(function (r) {
      return r.json().then(function (x) {
        x._status = r.status;
        return x;
      });
    });
  }
  var packsEl = document.getElementById('packs');
  var note = document.getElementById('note');
  var paid = document.getElementById('paid');
  var keybox = document.getElementById('keybox');
  var left = document.getElementById('left');
  var email = document.getElementById('email');

  function say(t) { if (note) note.textContent = t || ''; }

  function renderPacks(list, stripeOn) {
    if (!packsEl) return;
    packsEl.innerHTML = '';
    (list || []).forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'salt-pack';
      b.dataset.pack = p.id;
      b.innerHTML = '<strong>' + p.name + '</strong><span>' + p.blurb + '</span>';
      b.onclick = function () {
        var pack = p.id;
        b.disabled = true;
        say('Opening checkout…');
        j('POST', '/api/salt/host/checkout', { pack: pack, email: (email && email.value) || '' }).then(function (out) {
          if (out && out.url) {
            location.href = out.url;
            return;
          }
          b.disabled = false;
          say((out && out.error) || 'Checkout is not live yet. Add STRIPE_SECRET_KEY on Vercel.');
        }).catch(function () {
          b.disabled = false;
          say('Could not reach Salt.');
        });
      };
      packsEl.appendChild(b);
    });
    if (!stripeOn) say('Cards open when STRIPE_SECRET_KEY is on this Vercel project. Packs are ready.');
  }

  j('GET', '/api/salt/host/packs').then(function (out) {
    renderPacks(out.packs, out.stripe);
  }).catch(function () {
    renderPacks([
      { id: 'start', name: 'Start', blurb: '$9 · 1,000 live yeses' },
      { id: 'desk', name: 'Desk', blurb: '$29 · 4,000 live yeses' },
      { id: 'floor', name: 'Floor', blurb: '$99 · 20,000 live yeses' }
    ], false);
  });

  var q = new URLSearchParams(location.search);
  var sid = q.get('session_id');
  if (sid) {
    say('Confirming payment…');
    j('GET', '/api/salt/host/session/' + encodeURIComponent(sid)).then(function (out) {
      if (!out || !out.ok) {
        say((out && out.error) || 'Payment not finished.');
        return;
      }
      if (paid) paid.hidden = false;
      if (keybox) keybox.textContent = out.key || '(key already shown — check your records)';
      if (left) left.textContent = (out.left || 0) + ' live yeses on this key.';
      say('Paid. That key is live. Put it in SALT_KEY. Human never sees it.');
    }).catch(function () { say('Could not load this session.'); });
  }
})();
