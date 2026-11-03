/* DPE topic video player.
   Plays a topic's animated page (#root, 1920x1080) in step with its narration (#vo) and
   module music (#bed). The narration's clock drives the animation timeline, so pausing,
   seeking and speed changes keep pictures, captions and voice together.
   - Space / K: play or pause · C: captions · F: fullscreen
   - inside a deck (iframe): other keys go to the deck, so the arrows still change slides;
     the deck can send {type:"dpe-player", cmd:"toggle"|"play"|"pause"}
   - standalone: ← / → jump 5 seconds
   - ?preview=1: a still poster frame only (presenter-view thumbnails) */
(function () {
  var root = document.getElementById('root');
  var tl = window.__timelines && window.__timelines.main;
  var vo = document.getElementById('vo'), bed = document.getElementById('bed');
  var TOTAL = parseFloat(root.getAttribute('data-duration'));
  var LEAD = parseFloat(vo.getAttribute('data-start'));
  var VO_DUR = parseFloat(vo.getAttribute('data-duration'));
  var BED_VOL = parseFloat(bed.getAttribute('data-volume') || '0.08');
  var POSTER_T = 1.15;
  var embedded = window.parent !== window;
  var preview = /[?&]preview=/.test(location.search);
  var clips = [].slice.call(root.querySelectorAll('[data-start]')).filter(function (el) {
    return el.tagName !== 'AUDIO';
  }).map(function (el) {
    var s = parseFloat(el.getAttribute('data-start'));
    return { el: el, s: s, e: s + parseFloat(el.getAttribute('data-duration')) };
  });
  vo.removeAttribute('class'); bed.removeAttribute('class');
  bed.loop = true; vo.preload = 'auto'; bed.preload = 'auto';

  // ---- stage: scale the 1920x1080 page to fit the window
  var css = document.createElement('style');
  css.textContent =
    'html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#000}' +
    '#stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;cursor:pointer}' +
    '#root{flex:none;transform-origin:center center}' +
    '#root.nocap .cap{display:none}' +
    '#ui{position:fixed;left:0;right:0;bottom:0;z-index:10;font:600 15px/1 "Plus Jakarta Sans",Helvetica,Arial,sans-serif;color:#fff;' +
      'background:linear-gradient(0deg,rgba(0,0,0,.72),rgba(0,0,0,0));padding:28px 18px 14px;transition:opacity .3s}' +
    '#ui.hide{opacity:0;pointer-events:none}' +
    '#ui .pl-row{display:flex;align-items:center;gap:12px}' +
    '#ui button{flex:none;background:rgba(255,255,255,.14);border:0;color:#fff;font:inherit;height:36px;min-width:36px;padding:0 12px;border-radius:9px;cursor:pointer}' +
    '#ui button:hover{background:rgba(255,255,255,.28)}#ui button.off{opacity:.5}' +
    '#ui .pl-time{flex:none;font-variant-numeric:tabular-nums;opacity:.9;min-width:96px}' +
    '#ui input{flex:1;accent-color:#F4B400;height:4px;cursor:pointer}' +
    '#big{position:fixed;left:50%;top:50%;width:110px;height:110px;margin:-55px 0 0 -55px;border-radius:50%;border:0;z-index:11;cursor:pointer;' +
      'background:rgba(244,180,0,.96);box-shadow:0 10px 40px rgba(0,0,0,.4)}' +
    '#big::after{content:"";position:absolute;left:56%;top:50%;transform:translate(-50%,-50%);border-style:solid;border-width:22px 0 22px 36px;border-color:transparent transparent transparent #0B2545}' +
    '#big.hide{display:none}' +
    // narrow phones: keep CC and speed on screen
    '@media(max-width:480px){#ui{padding:24px 10px 12px}#ui .pl-row{gap:8px}#ui .pl-time{min-width:0;font-size:13px}#ui button{padding:0 9px}}';
  document.head.appendChild(css);
  var stage = document.createElement('div'); stage.id = 'stage';
  root.parentNode.insertBefore(stage, root); stage.appendChild(root);
  function fit() {
    var k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    root.style.transform = 'scale(' + k + ')';
    root.style.margin = ((1080 * k - 1080) / 2) + 'px ' + ((1920 * k - 1920) / 2) + 'px';
  }
  window.addEventListener('resize', fit); fit();

  // ---- rendering a moment
  var t = 0, playing = false, last = 0, rate = 1, raf = 0;
  function render(x) {
    t = Math.max(0, Math.min(TOTAL, x));
    if (tl) tl.seek(t, false);
    for (var i = 0; i < clips.length; i++) {
      var c = clips[i];
      c.el.style.visibility = (t >= c.s && t < c.e) || (t >= TOTAL && c.e >= TOTAL) ? '' : 'hidden';
    }
    var fadeIn = Math.min(1, t / 1.5), fadeOut = Math.min(1, Math.max(0, (TOTAL - t) / 3));
    bed.volume = Math.max(0, Math.min(1, BED_VOL * fadeIn * fadeOut));
    if (ui) { bar.value = (t / TOTAL * 1000) | 0; time.textContent = fmt(t) + ' / ' + fmt(TOTAL); }
  }
  function fmt(s) { s = Math.floor(s); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }

  if (preview) { render(POSTER_T); return; }

  // ---- controls
  var ui = document.createElement('div'); ui.id = 'ui';
  ui.innerHTML = '<div class="pl-row"><button id="pp" title="Play (Space)" aria-label="Play">▶</button><span class="pl-time"></span>' +
    '<input type="range" min="0" max="1000" value="0" aria-label="Seek">' +
    '<button id="cc" title="Captions (C)" aria-label="Captions">CC</button><button id="sp" title="Speed" aria-label="Playback speed 1×">1×</button>' +
    '<button id="fs" title="Fullscreen (F)" aria-label="Fullscreen">⛶</button></div>';
  document.body.appendChild(ui);
  var big = document.createElement('button'); big.id = 'big'; big.title = 'Play'; big.setAttribute('aria-label', 'Play video'); document.body.appendChild(big);
  var pp = ui.querySelector('#pp'), time = ui.querySelector('.pl-time'), bar = ui.querySelector('input');
  var cc = ui.querySelector('#cc'), sp = ui.querySelector('#sp'), fs = ui.querySelector('#fs');

  function syncAudio() {
    var vt = t - LEAD;
    if (vt >= 0 && vt < VO_DUR) {
      if (Math.abs(vo.currentTime - vt) > 0.25) vo.currentTime = vt;
      if (playing && vo.paused) vo.play().catch(function () {});
    } else if (!vo.paused) vo.pause();
    if (bed.duration && Math.abs(bed.currentTime - (t % bed.duration)) > 1) bed.currentTime = t % bed.duration;
    if (playing && bed.paused) bed.play().catch(function () {});
  }
  function tick(now) {
    if (!playing) return;
    var dt = (now - last) / 1000; last = now;
    if (!vo.paused && t >= LEAD && t < LEAD + VO_DUR) t = LEAD + vo.currentTime;
    else t += dt * rate;
    if (t >= TOTAL) { render(TOTAL); pause(); return; }
    if ((t >= LEAD && t < LEAD + VO_DUR && vo.paused) || (t >= LEAD + VO_DUR && !vo.paused)) syncAudio();
    render(t);
    raf = requestAnimationFrame(tick);
  }
  function play() {
    if (playing) return;
    if (t >= TOTAL - 0.05 || started === false) { t = 0; }
    started = true; playing = true; last = performance.now();
    syncAudio(); pp.textContent = '❚❚'; pp.setAttribute('aria-label', 'Pause'); big.classList.add('hide');
    raf = requestAnimationFrame(tick); idle();
  }
  function pause() {
    playing = false; cancelAnimationFrame(raf); vo.pause(); bed.pause();
    pp.textContent = t >= TOTAL ? '↺' : '▶'; pp.setAttribute('aria-label', t >= TOTAL ? 'Replay' : 'Play'); ui.classList.remove('hide');
    if (t >= TOTAL) big.classList.remove('hide');
  }
  function toggle() { if (playing) pause(); else play(); }
  function seek(x) { started = true; render(x); syncAudio(); big.classList.add('hide'); if (!playing) { pp.textContent = '▶'; pp.setAttribute('aria-label', 'Play'); } }
  var started = false;

  pp.onclick = function (e) { e.stopPropagation(); toggle(); };
  big.onclick = function (e) { e.stopPropagation(); play(); };
  stage.onclick = toggle;
  bar.oninput = function () { seek(bar.value / 1000 * TOTAL); };
  cc.onclick = function (e) { e.stopPropagation(); root.classList.toggle('nocap'); cc.classList.toggle('off'); };
  var rates = [1, 1.25, 0.85];
  sp.onclick = function (e) {
    e.stopPropagation(); rate = rates[(rates.indexOf(rate) + 1) % rates.length];
    vo.playbackRate = rate; sp.textContent = rate + '×'; sp.setAttribute('aria-label', 'Playback speed ' + rate + '×');
  };
  fs.onclick = function (e) {
    e.stopPropagation();
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(function () {});
  };

  // hide the controls while playing and the mouse is still
  var hideT = 0;
  function idle() { ui.classList.remove('hide'); clearTimeout(hideT); hideT = setTimeout(function () { if (playing) ui.classList.add('hide'); }, 2500); }
  document.addEventListener('mousemove', idle);

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key;
    if (k === ' ' || k === 'k' || k === 'K') { e.preventDefault(); toggle(); return; }
    if (k === 'c' || k === 'C') { cc.click(); return; }
    if (k === 'f' || k === 'F') { fs.click(); return; }
    if (!embedded && (k === 'ArrowRight' || k === 'ArrowLeft')) { e.preventDefault(); seek(t + (k === 'ArrowRight' ? 5 : -5)); return; }
    if (embedded) { e.preventDefault(); window.parent.postMessage({ type: 'dpe-key', key: k }, '*'); }
  });
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type !== 'dpe-player') return;
    if (d.cmd === 'toggle') toggle(); else if (d.cmd === 'play') play(); else if (d.cmd === 'pause') pause();
  });

  render(POSTER_T);
  time.textContent = '0:00 / ' + fmt(TOTAL);
})();
