// node tools/build-artifact.js <出力先.html>
// index.html と CSS / JS を 1 ファイルにまとめる（claude.ai アーティファクトや単体配布用）。
// <html>/<head>/<body> は外し、<title> と <style> を先頭に置く。
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = process.argv[2] || path.join(root, 'dist', 'voice-emotion.html');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
const inlined = body.replace(/<script src="([^"]+)"><\/script>/g, (_, src) =>
  '<script>\n' + fs.readFileSync(path.join(root, src), 'utf8').replace(/<\/script/gi, '<\\/script') + '\n</script>');
const page = [title, '<meta name="claude:viewport-fit-sides" content="cover">', '<style>\n' + css + '</style>', inlined.trim()].join('\n');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page + '\n');
console.log('wrote ' + out + ' (' + (page.length / 1024).toFixed(1) + ' KB)');
