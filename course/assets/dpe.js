/* Digital Productivity Essentials · slide interactions
   - .opt            quick-check option: click to reveal right/wrong (+ .why)
   - .reveal-btn     shows the element named in data-target (an .answer)
   - .timer          activity countdown: data-min="3"; click start/pause, double-click reset
   - .video          YouTube card: data-yt="VIDEO_ID" (opens in a new tab; optional data-start="SECONDS")
   - .flip           click to flip a two-sided card
   - .shots          real-app screenshot walk-through: pointer, click, gold rings, zoom (see below)
   Footer brand line and slide numbers are filled in automatically.
   Inside the LMS (in a frame): html.in-lms; with ?p=1 (participants) html.participant
   hides answer reveals. Swipe left/right changes slides on touch screens, and the
   frame tells the LMS which slide is showing ({type:'dpe-slide', n, total}). */
(function () {
  var participant = /[?&]p=1/.test(location.search) || /\/course\/p\//.test(location.pathname);   // the participant copy (no answers in it) is always participant mode
  if (window.parent !== window) document.documentElement.classList.add('in-lms');
  if (participant) document.documentElement.classList.add('participant');

  document.addEventListener('click', function (e) {
    var opt = e.target.closest('.opt');
    if (opt) {
      if (participant) {   // mark the pick, but the facilitator reveals what's right
        if (opt.closest('.qc')) opt.closest('.qc').querySelectorAll('.opt').forEach(function (o) { o.classList.toggle('picked', o === opt); });
        return;
      }
      var group = opt.closest('.qc');
      opt.classList.add('shown');
      if (opt.hasAttribute('data-correct') && group) group.classList.add('solved');
      return;
    }
    var rb = e.target.closest('.reveal-btn');
    if (rb) {
      var t = document.getElementById(rb.getAttribute('data-target'));
      if (t) t.classList.toggle('shown');
      return;
    }
    var v = e.target.closest('.video');
    if (v) {
      var id = v.getAttribute('data-yt');
      var s = v.getAttribute('data-start');
      window.open('https://www.youtube.com/watch?v=' + id + (s ? '&t=' + s + 's' : ''), '_blank', 'noopener');
      return;
    }
    var f = e.target.closest('.flip');
    if (f) { f.classList.toggle('on'); return; }
    var tm = e.target.closest('.timer');
    if (tm) toggleTimer(tm);
  });

  document.addEventListener('dblclick', function (e) {
    var tm = e.target.closest('.timer');
    if (tm) resetTimer(tm);
  });

  function fmt(s) { var m = Math.floor(s / 60), r = s % 60; return m + ':' + (r < 10 ? '0' : '') + r; }
  function initTimer(tm) {
    var total = Math.round(parseFloat(tm.getAttribute('data-min') || '3') * 60);
    tm._total = total; tm._left = total; tm.textContent = fmt(total);
  }
  function resetTimer(tm) {
    clearInterval(tm._iv); tm._iv = null; tm.classList.remove('running', 'done'); initTimer(tm);
  }
  function toggleTimer(tm) {
    if (tm._left === undefined) initTimer(tm);
    if (tm._iv) { clearInterval(tm._iv); tm._iv = null; tm.classList.remove('running'); return; }
    if (tm._left <= 0) resetTimer(tm);
    tm.classList.add('running');
    tm._iv = setInterval(function () {
      tm._left -= 1; tm.textContent = fmt(Math.max(tm._left, 0));
      if (tm._left <= 0) { clearInterval(tm._iv); tm._iv = null; tm.classList.remove('running'); tm.classList.add('done'); tm.textContent = 'Time!'; }
    }, 1000);
  }

  // Back to the course index: the house button (top right) or the H key.
  // Hidden in presenter-view previews (?preview=N).
  var isPreview = /[?&]preview=/.test(location.search);
  document.addEventListener('keydown', function (e) {
    if (isPreview || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'h' || e.key === 'H') goHome();
  });

  // Inside the LMS (deck shown in a frame) home means the LMS home, so ask the parent page.
  var inLms = window.parent !== window;
  function goHome() {
    if (inLms) window.parent.postMessage({ type: 'dpe-home' }, '*');
    else location.href = 'index.html';
  }

  // Full-screen topic video (.vslide): an animated page in an iframe (videos/<id>/index.html).
  // Space or K plays/pauses while it is on screen, the arrows still move between slides
  // (the player passes other keys back here), and leaving the slide pauses it.
  function player(cmd, sl) {
    sl = sl || document.querySelector('.deck > .slide.vslide.is-active');
    var fr = sl && sl.querySelector('iframe');
    if (fr && fr.contentWindow) fr.contentWindow.postMessage({ type: 'dpe-player', cmd: cmd }, '*');
  }
  window.addEventListener('keydown', function (e) {
    if (isPreview || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!(e.key === ' ' || e.key === 'k' || e.key === 'K')) return;
    if (!document.querySelector('.deck > .slide.vslide.is-active')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    player('toggle');
  }, true);
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'dpe-key' && d.key) document.dispatchEvent(new KeyboardEvent('keydown', { key: d.key, bubbles: true }));
    if (d.type === 'dpe-act' && e.source === window.parent) showAct(d.n, d.html);
  });

  // The LMS's activity card (status + button), placed under the slide's own content.
  // Its button asks the LMS to open the activity ({type:'dpe-go', to:'#/a/<id>'}).
  function showAct(n, html) {
    document.querySelectorAll('.lms-act').forEach(function (x) { x.remove(); });
    var sl = document.querySelectorAll('.deck > .slide')[n - 1];
    if (!sl || !html) return;
    var box = document.createElement('div');
    box.className = 'lms-act';
    box.innerHTML = html;
    sl.insertBefore(box, sl.querySelector('.deck-footer'));
  }
  document.addEventListener('click', function (e) {
    var go = e.target.closest('.lms-act [data-go]');
    if (go) window.parent.postMessage({ type: 'dpe-go', to: go.getAttribute('data-go') }, '*');
  });

  // Screenshot walk-through (.shots): real app screenshots, one <figure class="f"> per click.
  // The pointer glides to the target, clicks, the gold rings (.ring, --x/--y/--w/--h in % of
  // the image) light up, then the picture zooms (data-zoom="1.6" around data-at="x,y", or data-o="x,y").
  // Next/Back keys walk the frames before leaving the slide; click the picture or a step
  // (li[data-step], matching the frames' data-step) to jump. Back into a slide = its last frame.
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var CUR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';   // Lucide "mouse-pointer-2"
  function shotAt(f) {
    var a = (f.getAttribute('data-at') || '').split(','), r = f.querySelector('.ring');
    if (a.length === 2) return [+a[0], +a[1]];
    if (!r) return null;
    var g = function (k) { return parseFloat(r.style.getPropertyValue('--' + k)) || 0; };
    return [g('x') + g('w') / 2, g('y') + g('h') / 2];
  }
  function shotGo(box, i) {
    var fs = box.querySelectorAll('.f'); if (!fs.length) return;
    i = Math.max(0, Math.min(fs.length - 1, i));
    var prev = box._i, f = fs[i], pic = f.querySelector('.pic'), at = shotAt(f);
    box._i = i; clearTimeout(box._t1); clearTimeout(box._t2);
    // tell the LMS which step is showing, so its counter and Next button say "step 2/5" and "Next step"
    // (after the slide's own dpe-slide message, which resets them)
    if (box.hasAttribute('data-walk') && window.parent !== window)
      setTimeout(function () {
        var sl = box.closest('.slide'), no = Array.prototype.indexOf.call(document.querySelectorAll('.deck > .slide'), sl) + 1;
        if (!no || box._i !== i || !sl.classList.contains('is-active')) return;   // a copy of the slide (overview), or the deck moved on
        window.parent.postMessage({ type: 'dpe-step', i: i + 1, n: fs.length, slide: no }, '*');
      }, 0);
    fs.forEach(function (x, k) { x.classList.toggle('on', k === i); x.classList.remove('shown', 'zoomed'); });
    var st = f.getAttribute('data-step');
    box.querySelectorAll('[data-step]:not(.f)').forEach(function (li) {
      var s = li.getAttribute('data-step');
      li.classList.toggle('on', s === st);
      li.classList.toggle('done', st != null && +s < +st);
    });
    var z = parseFloat(f.getAttribute('data-zoom')) || 1;
    var o = (f.getAttribute('data-o') || '').split(',');   // zoom anchor, when the pointer's spot sits too close to an edge
    if (o.length === 2) pic.style.transformOrigin = o[0] + '% ' + o[1] + '%';
    else if (at) pic.style.transformOrigin = at[0] + '% ' + at[1] + '%';
    pic.style.setProperty('--z', z);
    var cur = box._cur;
    if (!cur) { cur = box._cur = document.createElement('i'); cur.className = 'cur'; cur.innerHTML = CUR; box._pos = [50, 70]; }
    if (cur.parentNode !== pic) pic.appendChild(cur);
    cur.classList.remove('click'); cur.style.display = at ? '' : 'none';
    var done = function () { f.classList.add('shown'); if (z > 1) f.classList.add('zoomed'); };
    if (still || !at) { if (at) { cur.style.left = at[0] + '%'; cur.style.top = at[1] + '%'; box._pos = at; } done(); return; }
    cur.style.transition = 'none';
    cur.style.left = box._pos[0] + '%'; cur.style.top = box._pos[1] + '%';
    void cur.offsetWidth; cur.style.transition = '';
    cur.style.left = at[0] + '%'; cur.style.top = at[1] + '%'; box._pos = at;
    box._t1 = setTimeout(function () { cur.classList.add('click'); f.classList.add('shown'); }, prev === undefined ? 500 : 750);
    if (z > 1) box._t2 = setTimeout(function () { f.classList.add('zoomed'); }, prev === undefined ? 1100 : 1350);
  }
  var shotDir = 1;
  window.addEventListener('keydown', function (e) {
    if (isPreview || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    var fwd = /^(ArrowRight|ArrowDown|PageDown| )$/.test(e.key), back = /^(ArrowLeft|ArrowUp|PageUp)$/.test(e.key);
    if (!fwd && !back) return;
    shotDir = fwd ? 1 : -1;
    var box = document.querySelector('.deck > .slide.is-active .shots[data-walk]');
    if (!box) return;
    var n = box.querySelectorAll('.f').length, i = box._i || 0;
    if (fwd ? i >= n - 1 : i <= 0) return;   // past the ends: the deck moves on
    e.preventDefault(); e.stopImmediatePropagation();
    shotGo(box, i + shotDir);
  }, true);
  document.addEventListener('click', function (e) {
    var li = e.target.closest('.shots [data-step]:not(.f)'), box = e.target.closest('.shots');
    if (!box) return;
    if (li) {
      var f = box.querySelector('.f[data-step="' + li.getAttribute('data-step') + '"]');
      if (f) shotGo(box, Array.prototype.indexOf.call(box.querySelectorAll('.f'), f));
    } else if (e.target.closest('.stage') && box.hasAttribute('data-walk')) {
      var n = box.querySelectorAll('.f').length, i = box._i || 0;
      if (i < n - 1) shotGo(box, i + 1);
      else key('ArrowRight');   // last step: a tap moves on to the next slide (never loops back)
    }
  });
  function shotsInit() {
    document.querySelectorAll('.shots').forEach(function (box) {
      var sl = box.closest('.slide'), n = box.querySelectorAll('.f').length;
      var enter = function () {
        if (!sl.classList.contains('is-active')) { box._on = false; return; }
        if (box._on) return; box._on = true;
        box._i = undefined; box._pos = [50, 70];
        shotGo(box, isPreview ? n - 1 : (shotDir < 0 ? n - 1 : 0));
      };
      new MutationObserver(enter).observe(sl, { attributes: true, attributeFilter: ['class'] });
      enter();
      if (!sl.classList.contains('is-active')) shotGo(box, 0);   // first frame for thumbnails / overview
    });
  }

  // Swipe: a mostly sideways drag of 50px or more moves one slide.
  function key(k) { document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); }
  var tx = null, ty = 0;
  document.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { tx = null; return; }
    tx = e.touches[0].clientX; ty = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (tx === null) return;
    var dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty; tx = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    key(dx < 0 ? 'ArrowRight' : 'ArrowLeft');
  }, { passive: true });

  document.addEventListener('DOMContentLoaded', function () {
    // tell the LMS which slide is on screen
    if (window.parent !== window) {
      var all = document.querySelectorAll('.deck > .slide'), last = -1;
      var tell = function () {
        var n = Array.prototype.findIndex.call(all, function (x) { return x.classList.contains('is-active'); });
        if (n === last) return; last = n;
        window.parent.postMessage({ type: 'dpe-slide', n: n + 1, total: all.length }, '*');
      };
      all.forEach(function (x) { new MutationObserver(tell).observe(x, { attributes: true, attributeFilter: ['class'] }); });
      setTimeout(tell, 0);
    }
    document.querySelectorAll('.deck > .slide.vslide iframe[data-src]').forEach(function (fr) {
      fr.src = fr.getAttribute('data-src') + (isPreview ? '?preview=1' : '');
      if (isPreview) return;
      var sl = fr.closest('.slide');
      new MutationObserver(function () {
        if (!sl.classList.contains('is-active')) player('pause', sl);
      }).observe(sl, { attributes: true, attributeFilter: ['class'] });
    });
    if (!isPreview) {
      var home = document.createElement('a');
      home.className = 'home-btn'; home.href = 'index.html';
      home.addEventListener('click', function (ev) { if (inLms) { ev.preventDefault(); goHome(); } });
      home.title = 'Course index (H)'; home.setAttribute('aria-label', 'Course index');
      home.innerHTML = '<svg class="ico" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>';   // Lucide "house"
      document.body.appendChild(home);
    }
    document.querySelectorAll('.timer').forEach(initTimer);
    shotsInit();
    // Partner logos: DICT (organizer), BIR (participants), Serial Disruptors (resource person's organization).
    var LOGOS = '<img src="images/logos/dict.png" alt="DICT">' +
                '<img src="images/logos/bir.png" alt="Bureau of Internal Revenue">' +
                '<img class="sd" src="images/logos/serial-disruptors.png" alt="Serial Disruptors">';
    document.querySelectorAll('.deck > .slide.cover .cv-text').forEach(function (t) {
      if (t.querySelector('.cv-logos')) return;
      var bar = document.createElement('div');
      bar.className = 'cv-logos';
      bar.innerHTML = LOGOS;
      t.appendChild(bar);
    });

    // Footer on every slide: brand line left, partner logos + slide count right.
    var body = document.body;
    var brand = body.getAttribute('data-brand') || 'Digital Productivity Essentials';
    var slides = document.querySelectorAll('.deck > .slide');
    slides.forEach(function (sl, i) {
      if (sl.querySelector('.deck-footer') || sl.hasAttribute('data-nofooter')) return;
      var f = document.createElement('div');
      f.className = 'deck-footer';
      f.innerHTML = '<span class="brandline">' + brand + '</span><span class="foot-right"><span class="foot-logos">' + LOGOS +
                    '</span><span>' + (i + 1) + ' / ' + slides.length + '</span></span>';
      sl.appendChild(f);
    });
  });
})();
