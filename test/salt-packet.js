'use strict';
const fs = require('fs');
const path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }
function ok(name, cond) { if (!cond) throw new Error('FAIL ' + name); console.log('ok', name); }

const css = read('css/salt.css');
const js = read('js/salt.js');
const jpg = fs.readFileSync(path.join(__dirname, '..', 'img', 'salt-packet.jpg'));
ok('packet css', /salt-pkt/.test(css) && /salt-pop/.test(css));
ok('photoreal packet photo', /salt-photo/.test(css) && /salt-packet\.jpg/.test(js) && /salt-pkt--knock/.test(css));
ok('jpeg is a real photo', jpg[0] === 0xff && jpg[1] === 0xd8 && jpg.length > 80000);
ok('markup is the photo not a css card', /class="salt-photo"/.test(js) && !/salt-end--l/.test(js) && !/salt-word/.test(js));
ok('yes is on the packet', /class="salt-yes">Yes/.test(js) && /\.salt-yes/.test(css));
ok('no giant extruded word', !/font-size:\s*42px/.test(css) && !/\.salt-blue/.test(css));
ok('phone knock opens the packet', /salt-pkt--knock/.test(js) && /salt-knock/.test(js));
ok('helper pops a packet not a page', /function pop\(/.test(js) && /salt-float/.test(js));
ok('page has a stage not a modal', /salt-stage/.test(read('index.html')) && !/modal/i.test(read('index.html')));
ok('home shows the photo', /salt-packet\.jpg/.test(read('index.html')) && /salt-packet\.jpg/.test(read('salt.html')));
ok('hidden stage does not eat the fold', /\.salt-stage\[hidden\]\s*\{\s*display:\s*none/.test(css));
ok('click face to open', /aria-label="Salt — open"/.test(js) && /salt-face/.test(js));
ok('yes() pops the packet', /pop\(ch/.test(js));
ok('host page is a till not a desk', /Buy live yeses/.test(read('host.html')) && /human never pays/i.test(read('host.html')));
ok('photo is served cross-origin', /img\/salt-packet\.jpg/.test(read('vercel.json')) && /Cross-Origin-Resource-Policy/.test(read('vercel.json')));

console.log('salt-packet: all ok');
