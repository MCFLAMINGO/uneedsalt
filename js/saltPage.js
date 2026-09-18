(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  var id = q.get('c') || q.get('id') || '';
  var stage = document.getElementById('salt-stage');
  var home = document.getElementById('home');

  if (id && window.Salt) {
    document.body.classList.add('salt-knock');
    if (stage) stage.hidden = false;
    if (home) home.hidden = true;
    Salt.poll(id).then(function (c) {
      if (!c || c.error) {
        Salt.pop({ who: 'salt', action: 'gone', to: (c && c.error) || 'Gone.' });
        return;
      }
      Salt.pop(c, { host: stage });
    }).catch(function () {
      Salt.pop({ who: 'salt', action: 'gone', to: 'Could not load this knock.' }, { host: stage });
    });
    return;
  }

  if (home) home.hidden = false;
  if (stage) stage.hidden = true;
  var demo = document.getElementById('demo');
  var out = document.getElementById('demoOut');
  if (demo) demo.onclick = function () {
    demo.disabled = true;
    demo.textContent = 'Salt is up — tap Yes.';
    Salt.yes({
      who: 'your-app',
      action: 'pay',
      to: 'vendor',
      amount: '12',
      unit: 'USD'
    }).then(function (rec) {
      demo.disabled = false;
      demo.textContent = rec ? 'Got a yes — would run.' : 'No receipt — would not run.';
    }).catch(function (e) {
      demo.disabled = false;
      demo.textContent = 'Try one';
      if (out) { out.hidden = false; out.textContent = (e && e.message) || 'failed'; }
    });
  };
})();
