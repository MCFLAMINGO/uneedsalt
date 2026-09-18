'use strict';
const fs = require('fs');
const path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }
function ok(name, cond) { if (!cond) throw new Error('FAIL ' + name); console.log('ok', name); }

const css = read('css/salt.css');
const js = read('js/salt.js');
ok('packet css', /salt-pkt/.test(css) && /salt-pop/.test(css));
ok('sheet not a render', /salt-sheet/.test(css) && /border-radius:\s*16px/.test(css));
ok('yes is a Link tap', /class="salt-yes">Yes/.test(js) && /\.salt-yes/.test(css));
ok('no giant extruded word', !/font-size:\s*42px/.test(css) && !/salt-blue/.test(css));
ok('no zigzag sachet clip', !/clip-path/.test(css));
ok('helper pops a packet not a page', /function pop\(/.test(js) && /salt-float/.test(js));
ok('page has a stage not a modal', /salt-stage/.test(read('index.html')) && !/modal/i.test(read('index.html')));
ok('hidden stage does not eat the fold', /\.salt-stage\[hidden\]\s*\{\s*display:\s*none/.test(css));
ok('click face to open', /aria-label="Salt — open"/.test(js) && /salt-face/.test(js));
ok('yes() pops the packet', /pop\(ch/.test(js));
ok('host page is a till not a desk', /Buy live yeses/.test(read('host.html')) && /human never pays/i.test(read('host.html')));

console.log('salt-packet: all ok');
