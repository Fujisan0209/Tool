// samples/index.html に入れたコードが、samples/ のファイルと同じかを確かめる
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'samples');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const blocks = [...html.matchAll(/<script type="text\/plain" id="src-[^"]+" data-file="([^"]+)">\n([\s\S]*?)\n<\/script>/g)];

test('すべてのサンプルがページに入っている', () => {
  const files = fs.readdirSync(dir).filter(f => /^hello\.|^Hello\./.test(f)).sort();
  assert.deepStrictEqual(blocks.map(b => b[1]).sort(), files);
});

for (const [, file, code] of blocks) {
  test(`${file} の中身がページと同じ`, () => {
    assert.strictEqual(code, fs.readFileSync(path.join(dir, file), 'utf8').replace(/\n$/, ''));
  });
}
