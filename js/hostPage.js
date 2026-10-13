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
      var pitch = document.getElementById('pitch');
      if (pitch) pitch.hidden = true;
      var n = Number(out.left || 0);
      if (keybox) keybox.textContent = out.key || 'This key was already shown once. It still holds these yeses. Put that same key in the snippet below.';
      if (left) {
        left.textContent = n.toLocaleString() + ' live yeses left. You paid for them. Each time a person taps Yes, one is spent. They are not charged.';
      }
      var sample = document.getElementById('sample');
      if (sample && out.key) sample.textContent = sample.textContent.split('sk_live_…').join(out.key);
      var paste = document.getElementById('paste');
      if (paste) paste.textContent = out.key ? 'Paste this on your app. Your key is already in it.' : 'Paste this on your app. Put the key you copied into SALT_KEY.';
      var title = document.getElementById('title');
      if (title) title.textContent = 'You have ' + n.toLocaleString() + ' yeses.';
      var show = document.getElementById('showpkt');
      var trynote = document.getElementById('trynote');
      if (show && out.key && window.Salt) {
        show.hidden = false;
        if (trynote) trynote.textContent = 'Opens the packet a person would see. Tapping Yes spends one yes from this pack.';
        show.onclick = function () {
          show.disabled = true;
          window.SALT_KEY = out.key;
          Salt.yes({
            who: 'your-app',
            action: 'pay',
            to: 'vendor',
            amount: '12',
            unit: 'USD',
            key: out.key
          }).then(function (rec) {
            show.disabled = false;
            if (rec && rec.live && left) {
              n = Math.max(0, n - 1);
              left.textContent = n.toLocaleString() + ' live yeses left. That tap spent one. The person was not charged. The $12 was not charged.';
            }
          }).catch(function () { show.disabled = false; });
        };
      }
      if (paid && paid.scrollIntoView) paid.scrollIntoView();
      say('');
    }).catch(function () { say('Could not load this session.'); });
  }
})();
