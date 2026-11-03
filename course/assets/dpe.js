/* Digital Productivity Essentials · slide interactions
   - .opt            quick-check option: click to reveal right/wrong (+ .why)
   - .reveal-btn     shows the element named in data-target (an .answer)
   - .timer          activity countdown: data-min="3"; click start/pause, double-click reset
   - .video          YouTube card: data-yt="VIDEO_ID" (opens in a new tab; optional data-start="SECONDS")
   - .flip           click to flip a two-sided card
   Footer brand line and slide numbers are filled in automatically.
   Inside the LMS (in a frame): html.in-lms; with ?p=1 (participants) html.participant
   hides answer reveals. Swipe left/right changes slides on touch screens, and the
   frame tells the LMS which slide is showing ({type:'dpe-slide', n, total}). */
(function () {
  var participant = /[?&]p=1/.test(location.search);
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
  });

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
