// node test/run.js — 合成音声で DSP と感情推定の挙動を確認する
'use strict';
const assert = require('assert');
const dsp = require('../js/dsp.js');
const emo = require('../js/emotion.js');

let failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log('  ok   ' + name),
    (e) => { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
  );
}

const demo = require('../js/demo.js');
const rnd = demo.rng(7);
const synth = (sr, sec, o) => demo.synth(sr, sec, o, rnd);

(async () => {
  console.log('DSP');
  const sr = 48000;

  await test('YIN が 80〜400Hz の純音を ±1% で推定', () => {
    const n = dsp.frameSizeFor(sr, 0.04);
    for (const f of [80, 110, 150, 220, 300, 400]) {
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = 0.3 * Math.sin(2 * Math.PI * f * i / sr) + 0.1 * Math.sin(4 * Math.PI * f * i / sr);
      const r = dsp.analyzeFrame(x, sr);
      assert(Math.abs(r.f0 - f) / f < 0.01, `f=${f} → ${r.f0.toFixed(1)}`);
      assert(r.clarity > 0.8, `clarity ${r.clarity}`);
    }
  });

  await test('白色雑音は低い明瞭度・高い平坦度', () => {
    const n = dsp.frameSizeFor(sr, 0.04), x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = rnd() - 0.5;
    const r = dsp.analyzeFrame(x, sr);
    assert(r.clarity < 0.7, 'clarity ' + r.clarity);
    assert(r.flatness > 0.4, 'flatness ' + r.flatness);
  });

  await test('スペクトル重心は明るい音ほど高い', () => {
    const n = dsp.frameSizeFor(sr, 0.04);
    const dark = synth(sr, 0.1, { f0: 150, var: 0, varHz: 1, amp: 0.2, tilt: 2.5, syl: 0.001 }).subarray(2000, 2000 + n);
    const bright = synth(sr, 0.1, { f0: 150, var: 0, varHz: 1, amp: 0.2, tilt: 0.8, syl: 0.001 }).subarray(2000, 2000 + n);
    assert(dsp.analyzeFrame(bright, sr).centroid > dsp.analyzeFrame(dark, sr).centroid * 1.5);
  });

  console.log('感情推定（合成音声・各 6 秒）');
  const { samples: audio, segments } = demo.makeDemo(sr);
  const order = segments.map((s) => s.id);

  const t0 = Date.now();
  const frames = await dsp.analyzeBuffer(audio, sr, { hopSec: 0.05 });
  const ms = Date.now() - t0;
  const res = emo.estimateAll(frames, 0.05);
  console.log(`  (${(audio.length / sr).toFixed(0)} 秒の音声を ${ms} ms で解析 / ${frames.length} フレーム)`);

  order.forEach((k, si) => {
    // 区間の後半 4 秒で多数決（平滑化の追従時間を除く）
    const cnt = {};
    for (const r of res) if (r.active && r.t > si * 6 + 2 && r.t < si * 6 + 6) cnt[r.dominant] = (cnt[r.dominant] || 0) + 1;
    const top = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
    const share = Object.entries(cnt).map(([e, c]) => `${e}:${c}`).join(' ');
    return test(`区間${si + 1} ${k} → 推定 ${top}  [${share}]`, () => assert.strictEqual(top, k));
  });

  console.log('頑健性（サンプリング周波数 × 乱数シード × ファイル/リアルタイム）');
  for (const srx of [16000, 44100, 48000]) {
    for (const sd of [2, 3]) {
      const d = demo.makeDemo(srx, null, 6, sd);
      const fr = await dsp.analyzeBuffer(d.samples, srx, { hopSec: 0.05 });
      for (const mode of ['file', 'live']) {
        let rs;
        if (mode === 'file') rs = emo.estimateAll(fr, 0.05);
        else { const e = new emo.Estimator({ hopSec: 0.05 }); rs = fr.map((f) => e.push(f)); }
        const miss = [];
        for (const sg of d.segments) {
          const c = {};
          for (const r of rs) if (r.active && r.t > sg.start + 2 && r.t < sg.end) c[r.dominant] = (c[r.dominant] || 0) + 1;
          const top = Object.keys(c).sort((x, y) => c[y] - c[x])[0];
          if (top !== sg.id) miss.push(`${sg.start}s ${sg.id}→${top}`);
        }
        await test(`${srx}Hz seed${sd} ${mode}: ${d.segments.length - miss.length}/${d.segments.length}`, () => assert.deepStrictEqual(miss, []));
      }
    }
  }

  await test('リアルタイム処理: 1 フレームあたり 2ms 未満', () => {
    const n = dsp.frameSizeFor(sr, 0.04);
    const est = new emo.Estimator({ hopSec: 0.05 });
    const s = Date.now();
    const N = 400;
    for (let i = 0; i < N; i++) {
      const f = dsp.analyzeFrame(audio.subarray(i * 2400, i * 2400 + n), sr);
      f.t = i * 0.05;
      est.push(f);
    }
    const per = (Date.now() - s) / N;
    console.log(`       ${per.toFixed(2)} ms/frame`);
    assert(per < 2);
  });

  await new Promise((r) => setTimeout(r, 0));
  console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
  process.exit(failed ? 1 : 0);
})();
