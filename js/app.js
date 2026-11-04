/* app.js — UI・音声入力・描画ループ */
(function () {
  'use strict';

  var DSP = window.VEDsp, EMO = window.VEEmotion, CH = window.VECharts, DEMO = window.VEDemo;
  var E = EMO.EMOTIONS, HOP = 0.05, LIVE_SPAN = 30, TRAIL_SEC = 4;
  var byId = function (id) { return document.getElementById(id); };

  var el = {
    mic: byId('btnMic'), file: byId('fileInput'), demo: byId('btnDemo'), csv: byId('btnCsv'),
    status: byId('status'), progress: byId('progress'), player: byId('player'),
    heroEmoji: byId('heroEmoji'), heroLabel: byId('heroLabel'), heroSub: byId('heroSub'),
    bars: byId('bars'), legend: byId('legend'), sumBars: byId('sumBars'), sumTable: byId('sumTable'),
    sumNote: byId('sumNote'), mA: byId('mA'), mV: byId('mV'), mF: byId('mF'), mD: byId('mD'),
    tl: byId('cvTimeline'), map: byId('cvMap'), pitch: byId('cvPitch'), db: byId('cvDb'), tip: byId('tip')
  };

  var state = {
    mode: null,          // 'live' | 'file'
    results: [],
    duration: 0,
    hoverT: null,
    live: null,
    dirty: true,
    theme: CH.theme(),
    maps: {}
  };

  // ---------- 静的な UI の組み立て ----------
  function barList(ul) {
    ul.innerHTML = '';
    var refs = {};
    E.forEach(function (e) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="name"><span class="swatch" style="background:var(--e-' + e.id + ')"></span> ' +
        e.label + '</span><span class="track"><span class="fill" style="background:var(--e-' + e.id +
        ')"></span></span><span class="pct">–</span>';
      ul.appendChild(li);
      refs[e.id] = { li: li, fill: li.querySelector('.fill'), pct: li.querySelector('.pct') };
    });
    return refs;
  }
  var nowBars = barList(el.bars);
  var sumBars = barList(el.sumBars);
  E.forEach(function (e) {
    var li = document.createElement('li');
    li.innerHTML = '<span class="swatch" style="background:var(--e-' + e.id + ')"></span>' + e.emoji + ' ' + e.label;
    el.legend.appendChild(li);
  });

  function setStatus(msg) { el.status.textContent = msg; }
  function setProgress(p) {
    if (p == null) { el.progress.hidden = true; return; }
    el.progress.hidden = false;
    el.progress.firstElementChild.style.width = (p * 100).toFixed(1) + '%';
  }
  function invalidate() { state.dirty = true; }

  // ---------- パネル更新 ----------
  function fmtSec(s) {
    if (s < 60) return s.toFixed(1) + ' 秒';
    return Math.floor(s / 60) + ' 分 ' + Math.round(s % 60) + ' 秒';
  }
  function signed(x) { return (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2); }

  function updateNow(r) {
    if (!r || !r.active) {
      el.heroEmoji.textContent = state.mode ? '🤫' : '🎙️';
      el.heroLabel.textContent = state.mode ? '無音' : '待機中';
      el.heroSub.textContent = state.mode ? '声が検出されていません' : '話しかけると推定が始まります';
      E.forEach(function (e) {
        nowBars[e.id].fill.style.width = '0%';
        nowBars[e.id].pct.textContent = '–';
        nowBars[e.id].li.classList.remove('top');
      });
      el.mA.textContent = el.mV.textContent = '–';
      el.mF.textContent = r && r.f0 ? Math.round(r.f0) + ' Hz' : '–';
      el.mD.textContent = r ? r.db.toFixed(0) + ' dB' : '–';
      return;
    }
    var top = E.filter(function (e) { return e.id === r.dominant; })[0];
    el.heroEmoji.textContent = top.emoji;
    el.heroLabel.textContent = top.label;
    var p = r.probs[top.id];
    el.heroSub.textContent = '確信度 ' + Math.round(p * 100) + '%' + (p < 0.4 ? '（あいまい）' : '');
    E.forEach(function (e) {
      var b = nowBars[e.id];
      b.fill.style.width = (r.probs[e.id] * 100).toFixed(1) + '%';
      b.pct.textContent = Math.round(r.probs[e.id] * 100) + '%';
      b.li.classList.toggle('top', e.id === r.dominant);
    });
    el.mA.textContent = signed(r.arousal);
    el.mV.textContent = signed(r.valence);
    el.mF.textContent = r.f0 ? Math.round(r.f0) + ' Hz' : '–';
    el.mD.textContent = r.db.toFixed(0) + ' dB';
  }

  var lastSumAt = 0;
  function updateSummary(force) {
    var now = performance.now();
    if (!force && now - lastSumAt < 500) return;
    lastSumAt = now;
    var s = EMO.summarize(state.results, HOP);
    var rows = '';
    E.forEach(function (e) {
      var share = s.speechSec ? s.dominantSec[e.id] / s.speechSec : 0;
      sumBars[e.id].fill.style.width = (share * 100).toFixed(1) + '%';
      sumBars[e.id].pct.textContent = s.speechSec ? Math.round(share * 100) + '%' : '–';
      rows += '<tr><td>' + e.emoji + ' ' + e.label + '</td><td class="num">' + s.dominantSec[e.id].toFixed(1) +
        ' 秒</td><td class="num">' + (share * 100).toFixed(0) + '%</td><td class="num">' +
        (s.meanProb[e.id] * 100).toFixed(0) + '%</td></tr>';
    });
    el.sumTable.innerHTML = rows;
    el.sumNote.textContent = s.speechSec
      ? '発話 ' + fmtSec(s.speechSec) + ' のうち、各感情が最も強かった時間の割合です。'
      : '発話区間で最も強かった感情の時間割合です。';
    el.csv.disabled = !state.results.length;
  }

  // ---------- 描画ループ ----------
  function viewRange() {
    if (state.mode === 'file') return { t0: 0, t1: Math.max(state.duration, 1) };
    var last = state.results.length ? state.results[state.results.length - 1].t : 0;
    return { t0: Math.max(0, last - LIVE_SPAN), t1: Math.max(LIVE_SPAN, last) };
  }

  function currentT() {
    if (state.mode === 'file') return el.player.currentTime || 0;
    var r = state.results;
    return r.length ? r[r.length - 1].t : null;
  }

  function resultAt(t) {
    if (t == null) return null;
    var i = CH.indexAt(state.results, t);
    return i >= 0 ? state.results[i] : null;
  }

  /** 息継ぎ程度の短い無音（1.5 秒以内）は直前の感情を表示し続ける */
  function displayResultAt(t) {
    if (t == null) return null;
    var R = state.results, i = CH.indexAt(R, t);
    if (i < 0) return null;
    for (var k = i; k >= 0 && R[i].t - R[k].t <= 1.5; k--) if (R[k].active) return R[k];
    return R[i];
  }

  function draw() {
    var th = state.theme;
    var v = viewRange();
    var playT = state.mode === 'file' ? currentT() : null;
    var view = { t0: v.t0, t1: v.t1, hoverT: state.hoverT, playT: playT };
    state.maps.tl = CH.timeline(el.tl, state.results, view, th);
    state.maps.pitch = CH.line(el.pitch, state.results, 'f0', view, th, {
      min: 70, max: 450, log: true, ticks: [100, 200, 400], color: th.emo.sad,
      value: function (d) { return d.f0 > 0 ? d.f0 : NaN; }
    });
    state.maps.db = CH.line(el.db, state.results, 'db', view, th, {
      min: -70, max: 0, ticks: [-60, -40, -20, 0], color: th.emo.neutral,
      value: function (d) { return d.db; }
    });

    var focusT = state.hoverT != null ? state.hoverT : currentT();
    var trail = [];
    if (focusT != null && state.results.length) {
      var i = CH.indexAt(state.results, focusT);
      for (var k = Math.max(0, i - Math.round(TRAIL_SEC / HOP)); k <= i; k++) trail.push(state.results[k]);
    }
    CH.circumplex(el.map, trail, th);
    updateNow(displayResultAt(focusT));
    updateSummary();
  }

  function loop() {
    if (state.dirty || (state.mode === 'file' && !el.player.paused)) {
      state.dirty = false;
      draw();
    }
    requestAnimationFrame(loop);
  }

  // ---------- ホバー / クリック ----------
  function showTip(evt, t) {
    var r = resultAt(t);
    var html = '<div class="t">' + CH.fmtTime(t) + '</div>';
    if (r && r.active) {
      E.slice().reverse().forEach(function (e) {
        html += '<div class="row"><span><span class="swatch" style="background:var(--e-' + e.id + ')"></span>' +
          e.label + '</span><b>' + Math.round(r.probs[e.id] * 100) + '%</b></div>';
      });
    } else html += '<div class="row"><span>無音</span></div>';
    if (r && r.f0) html += '<div class="row"><span>声の高さ</span><b>' + Math.round(r.f0) + ' Hz</b></div>';
    el.tip.innerHTML = html;
    el.tip.hidden = false;
    var x = evt.clientX + 14, y = evt.clientY + 14;
    var tw = el.tip.offsetWidth, tht = el.tip.offsetHeight;
    if (x + tw > window.innerWidth - 8) x = evt.clientX - tw - 14;
    if (y + tht > window.innerHeight - 8) y = evt.clientY - tht - 14;
    el.tip.style.left = x + 'px';
    el.tip.style.top = y + 'px';
  }

  [['tl', el.tl], ['pitch', el.pitch], ['db', el.db]].forEach(function (pair) {
    var key = pair[0], cv = pair[1];
    cv.addEventListener('pointermove', function (evt) {
      var m = state.maps[key];
      if (!m || !state.results.length) return;
      var px = evt.clientX - cv.getBoundingClientRect().left;
      if (!m.inPlot(px)) { state.hoverT = null; el.tip.hidden = true; invalidate(); return; }
      var t = m.tAt(px);
      var lastT = state.results[state.results.length - 1].t;
      if (t < 0 || t > lastT) { state.hoverT = null; el.tip.hidden = true; invalidate(); return; }
      state.hoverT = t;
      showTip(evt, t);
      invalidate();
    });
    cv.addEventListener('pointerleave', function () { state.hoverT = null; el.tip.hidden = true; invalidate(); });
    cv.addEventListener('click', function (evt) {
      if (state.mode !== 'file') return;
      var m = state.maps[key];
      var t = m.tAt(evt.clientX - cv.getBoundingClientRect().left);
      el.player.currentTime = Math.max(0, Math.min(state.duration, t));
      el.player.play().catch(function () {});
    });
  });

  // ---------- マイク（リアルタイム） ----------
  function stopLive() {
    var L = state.live;
    if (!L) return;
    clearInterval(L.timer);
    L.stream.getTracks().forEach(function (tr) { tr.stop(); });
    L.ctx.close();
    state.live = null;
    el.mic.classList.remove('rec');
    el.mic.querySelector('.lbl').textContent = 'マイクで開始';
    setStatus('停止しました。発話 ' + fmtSec(EMO.summarize(state.results, HOP).speechSec) + ' を記録。CSV で書き出せます。');
    updateSummary(true);
  }

  function startLive() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('このブラウザ（または http 接続）ではマイクを使えません。https か localhost で開いてください。');
      return;
    }
    // 自動ゲイン・ノイズ抑圧は音量や声質の手がかりを壊すので切る
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
    }).then(function (stream) {
      resetFile();
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var src = ctx.createMediaStreamSource(stream);
      var an = ctx.createAnalyser();
      an.fftSize = DSP.frameSizeFor(ctx.sampleRate, 0.04);
      an.smoothingTimeConstant = 0;
      src.connect(an);
      var buf = new Float32Array(an.fftSize);
      var est = new EMO.Estimator({ hopSec: HOP });
      var t0 = ctx.currentTime;
      state.mode = 'live';
      state.results = [];
      state.live = {
        ctx: ctx, stream: stream, est: est,
        timer: setInterval(function () {
          an.getFloatTimeDomainData(buf);
          var f = DSP.analyzeFrame(buf, ctx.sampleRate);
          f.t = ctx.currentTime - t0;
          state.results.push(est.push(f));
          invalidate();
        }, HOP * 1000)
      };
      el.mic.classList.add('rec');
      el.mic.querySelector('.lbl').textContent = '停止';
      setStatus('録音中… 最初の 5〜10 秒は普段の声で話すと基準が安定します。');
      invalidate();
    }).catch(function (err) {
      setStatus('マイクを使えませんでした: ' + (err && err.message ? err.message : err));
    });
  }

  el.mic.addEventListener('click', function () { if (state.live) stopLive(); else startLive(); });

  // ---------- ファイル / デモ ----------
  function resetFile() {
    el.player.pause();
    if (el.player.src) URL.revokeObjectURL(el.player.src);
    el.player.removeAttribute('src');
    el.player.hidden = true;
  }

  function toMono(ab) {
    if (ab.numberOfChannels === 1) return ab.getChannelData(0);
    var out = new Float32Array(ab.length);
    for (var c = 0; c < ab.numberOfChannels; c++) {
      var d = ab.getChannelData(c);
      for (var i = 0; i < d.length; i++) out[i] += d[i] / ab.numberOfChannels;
    }
    return out;
  }

  function analyzeSamples(samples, sr, name, url) {
    if (state.live) stopLive();
    resetFile();
    state.mode = 'file';
    state.results = [];
    state.duration = samples.length / sr;
    invalidate();
    var t0 = performance.now();
    setStatus('解析中: ' + name);
    setProgress(0);
    return DSP.analyzeBuffer(samples, sr, { hopSec: HOP, onProgress: setProgress }).then(function (frames) {
      state.results = EMO.estimateAll(frames, HOP);
      setProgress(null);
      var ms = performance.now() - t0;
      setStatus(name + '（' + fmtSec(state.duration) + '）を ' + (ms / 1000).toFixed(2) +
        ' 秒で解析しました。再生するとグラフ上の位置と連動します。');
      if (url) { el.player.src = url; el.player.hidden = false; }
      updateSummary(true);
      invalidate();
    });
  }

  el.file.addEventListener('change', function () {
    var file = el.file.files && el.file.files[0];
    if (!file) return;
    setStatus('読み込み中: ' + file.name);
    file.arrayBuffer().then(function (buf) {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      return ctx.decodeAudioData(buf).then(function (ab) {
        ctx.close();
        return analyzeSamples(toMono(ab), ab.sampleRate, file.name, URL.createObjectURL(file));
      });
    }).catch(function (err) {
      setProgress(null);
      setStatus('この形式は読み込めませんでした（' + (err && err.message ? err.message : err) + '）。WAV / MP3 / M4A などをお試しください。');
    });
    el.file.value = '';
  });

  function wavUrl(samples, sr) {
    var n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    var w = function (o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  el.demo.addEventListener('click', function () {
    setStatus('デモ音声を生成中…');
    setTimeout(function () {
      var sr = 16000, d = DEMO.makeDemo(sr);
      var names = d.segments.map(function (s) {
        return E.filter(function (e) { return e.id === s.id; })[0].label;
      }).join('→');
      analyzeSamples(d.samples, sr, 'デモ音声', wavUrl(d.samples, sr)).then(function () {
        setStatus('デモ音声（合成、6 秒ごとに ' + names + '）を解析しました。');
      });
    }, 20);
  });

  // ---------- CSV ----------
  el.csv.addEventListener('click', function () {
    var head = ['time_sec', 'speech', 'dominant'].concat(E.map(function (e) { return 'p_' + e.id; }),
      ['arousal', 'valence', 'pitch_hz', 'level_db']);
    var lines = [head.join(',')];
    state.results.forEach(function (r) {
      lines.push([r.t.toFixed(2), r.active ? 1 : 0, r.active ? r.dominant : ''].concat(
        E.map(function (e) { return r.active ? r.probs[e.id].toFixed(3) : ''; }),
        [r.active ? r.arousal.toFixed(3) : '', r.active ? r.valence.toFixed(3) : '',
          r.f0 ? r.f0.toFixed(1) : '', r.db.toFixed(1)]).join(','));
    });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' }));
    a.download = 'voice-emotion-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  // ---------- その他 ----------
  ['seeked', 'pause', 'play'].forEach(function (ev) { el.player.addEventListener(ev, invalidate); });
  window.addEventListener('resize', invalidate);
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onTheme = function () { state.theme = CH.theme(); invalidate(); };
    if (mq.addEventListener) mq.addEventListener('change', onTheme); else if (mq.addListener) mq.addListener(onTheme);
  }
  document.addEventListener('visibilitychange', invalidate);

  updateSummary(true);
  requestAnimationFrame(loop);
})();
