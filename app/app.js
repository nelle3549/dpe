/* DPE LMS · participant + facilitator app (plain JS, hash routes)
   #/                home (participants: topics; admin: registration QR + topic controls)
   #/register #/login #/forgot #/reset
   #/topic/2.4       topic page (slides, video, activities)
   #/deck/2.4        slides viewer        #/video/2.4   video viewer
   #/a/2.4-a         activity page (participants open it from the QR / short link ?a=2.4-a)
   #/present/2.4     admin: deck + live topic / mark complete + answers panel (QR, short link, counts)
   #/results/2.4     admin: topic results, then Next topic / Home
   #/people          admin: participant list + CSV */
(function () {
  'use strict';
  var C = window.DPE_CONFIG, CAT = window.CATALOG;
  // Module 3 runs across both days (two-day schedule in Decks/index.html): Part 1 on Day 1, Part 2 from topic 3.5 on Day 2
  var DAY_SPLIT = { m3: { at: '3.5', hours: ['3 hours', '3 hours'] } };
  var sb = supabase.createClient(C.supabaseUrl, C.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true } });
  var $app = document.getElementById('app'), $modal = document.getElementById('modal-root');
  var BASE = location.origin + location.pathname;
  var SHORT = BASE.replace(/^https?:\/\//, '');
  var S = { session: null, profile: null, cohort: null, topics: {}, acts: {}, mine: {} };

  // ---------- catalog lookups
  var TOPIC = {}, ACT = {};
  CAT.forEach(function (m, mi) {
    m.topics.forEach(function (t, ti) {
      TOPIC[t.id] = { t: t, m: m, mi: mi, ti: ti };
      t.activities.forEach(function (a) { ACT[a.id] = { a: a, topic: t.id }; });
    });
  });
  var specs = {};
  function spec(tid) {
    if (!specs[tid]) specs[tid] = fetch('activities/' + tid + '.json', { cache: 'no-cache' }).then(function (r) { return r.json(); });
    return specs[tid];
  }

  // ---------- helpers
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var timers = [];
  function every(ms, fn) { timers.push(setInterval(fn, ms)); }
  function later(ms, fn) { timers.push(setTimeout(fn, ms)); }
  function clearTimers() { timers.forEach(function (t) { clearInterval(t); clearTimeout(t); }); timers = []; }
  function toast(msg) {
    var t = document.createElement('div'); t.className = 'toast' + (document.querySelector('.savebar') ? ' up' : ''); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600);
    var sr = document.getElementById('sr'); if (sr) { sr.textContent = ''; setTimeout(function () { sr.textContent = msg; }, 50); }   // screen readers
  }
  function copy(text) {
    var done = function () { toast('Link copied'); };
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(done, fallback);
    fallback();
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed: select the link'); }
      ta.remove();
    }
  }
  function qr(text) {
    var q = qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 8, margin: 2, scalable: true, alt: 'QR code: ' + text });
  }
  // two taps instead of confirm(): first tap arms the button, second within 4 s runs it
  function armed(btn, label, fn) {
    btn.addEventListener('click', function () {
      if (btn.classList.contains('armed')) { btn.classList.remove('armed'); fn(); return; }
      var old = btn.textContent; btn.classList.add('armed'); btn.textContent = label;
      setTimeout(function () { btn.classList.remove('armed'); btn.textContent = old; }, 4000);
    });
  }
  // pop-ups: focus moves in, Tab stays inside, Esc closes; focus returns on close
  function modalKeys(root, onEsc) {
    var prev = document.activeElement;
    function f() { return root.querySelectorAll('button:not([disabled]),a[href],input,select,textarea'); }
    function key(e) {
      if (!root.isConnected) return off();
      if (e.key === 'Escape') { e.preventDefault(); off(); onEsc(); return; }
      if (e.key !== 'Tab') return;
      var all = f(); if (!all.length) return;
      var first = all[0], last = all[all.length - 1];
      if (!root.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function off() { document.removeEventListener('keydown', key); if (prev && prev.isConnected && prev.focus) prev.focus(); }
    document.addEventListener('keydown', key);
    var all = f(); if (all.length) all[all.length - 1].focus();
    return off;
  }
  // inline field errors: mark the field, put the message under it, focus the first one
  function fieldErrors(list) {
    document.querySelectorAll('.field.bad').forEach(function (x) { x.classList.remove('bad'); });
    document.querySelectorAll('.ferr').forEach(function (x) { x.remove(); });
    document.querySelectorAll('[aria-invalid]').forEach(function (x) { x.removeAttribute('aria-invalid'); });
    list.forEach(function (e, k) {
      var inp = document.getElementById(e.id), fld = inp.closest('.field');
      fld.classList.add('bad'); inp.setAttribute('aria-invalid', 'true'); inp.setAttribute('aria-describedby', e.id + '-err');
      fld.insertAdjacentHTML('beforeend', '<div class="ferr" id="' + e.id + '-err">' + (e.html || esc(e.msg)) + '</div>');
      if (!k) inp.focus();
    });
    return list.length;
  }
  // Enter in a form field presses the card's main button; fixing a field clears its error
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.isComposing || !e.target.matches('.card[data-form] input')) return;
    var b = e.target.closest('.card').querySelector('button.btn.primary');
    if (b && !b.disabled) { e.preventDefault(); b.click(); }
  });
  document.addEventListener('input', function (e) {
    var fld = e.target.closest && e.target.closest('.field.bad');
    if (fld) { fld.classList.remove('bad'); var x = fld.querySelector('.ferr'); if (x) x.remove(); e.target.removeAttribute('aria-invalid'); }
    var card = e.target.closest && e.target.closest('.card[data-form]'), err = card && card.querySelector('.err');
    if (err) err.textContent = '';
  });
  function when(ts) { return ts ? new Date(ts).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : ''; }
  function clock(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
  // "2", "₱1,250.50", "2 folders" → a number; "two", "-2", "1e1" stay text (and count as not answered)
  function num(v) {
    if (v == null || v === '') return null;
    var s = String(v).trim().replace(/^(php|₱)\s*/i, '').replace(/\s+[a-z][a-z\s\-]*$/i, '').replace(/[,\s]/g, '');
    return /^\d+(\.\d+)?$/.test(s) ? Number(s) : String(v);
  }
  function pct(a, b) { return b ? Math.round(100 * a / b) : 0; }
  function fullName(p) { return (p.first_name + ' ' + p.last_name).trim(); }
  function errMsg(e) { return (e && (e.message || e.error_description)) || String(e); }
  function isAdmin() { return S.profile && S.profile.role === 'admin'; }
  // DICT preview accounts: every topic open, full decks, activities checked but never stored (S.tries lives only in this tab)
  function isViewer() { return S.profile && S.profile.role === 'viewer'; }
  // The facilitator sees the participants' pages, with her own controls (.fac) added on top.
  // "Hide my tools" removes them, so a Zoom screen share looks exactly like the participants' screen.
  // icons: Lucide SVGs (ISC licence) in place of emoji
  var ICONS = {
    'wrench': '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />',
    'eye': '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" />',
    'dot': '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>',
    'check': '<path d="M20 6 9 17l-5-5" />',
    'lock': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />',
    'play': '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
    'house': '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />',
    'hourglass': '<path d="M5 22h14" /><path d="M5 2h14" /><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" /><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />',
    'external-link': '<path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />',
    'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" />',
    'arrow-right': '<path d="M5 12h14" /><path d="m12 5 7 7-7 7" />',
    'clock': '<circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />',
    'timer': '<line x1="10" x2="14" y1="2" y2="2" /><line x1="12" x2="15" y1="14" y2="11" /><circle cx="12" cy="14" r="8" />',
    'paperclip': '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />',
    'x': '<path d="M18 6 6 18" /><path d="m6 6 12 12" />',
    'thumbs-up': '<path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />',
    'volume-x': '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" /><line x1="22" x2="16" y1="9" y2="15" /><line x1="16" x2="22" y1="9" y2="15" />',
    'volume-2': '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" /><path d="M16 9a5 5 0 0 1 0 6" /><path d="M19.364 18.364a9 9 0 0 0 0-12.728" />',
    'hand': '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" /><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" /><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />'
  };
  function ico(n) { return '<svg class="ico" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[n] + '</svg>'; }
  // emoji in activity text (Zoom reactions) shown as icons; s is already escaped
  function emo(s) { return s.replace(/👍\uFE0F?/g, ico('thumbs-up')).replace(/🔇\uFE0F?/g, ico('volume-x')).replace(/🔊\uFE0F?/g, ico('volume-2')); }
  function toolsIn() { var l = clean() ? 'Show my tools' : 'Hide my tools'; return (clean() ? ico('wrench') : ico('eye')) + '<span class="lbl"> ' + l + '</span>'; }
  function toolsBtn() { var l = clean() ? 'Show my tools' : 'Hide my tools'; return '<button id="tools" class="btn-top tools" aria-pressed="' + !clean() + '" title="' + l + '" aria-label="' + l + '">' + toolsIn() + '</button>'; }
  function clean() { try { return localStorage.getItem('dpeClean') === '1'; } catch (e) { return false; } }
  function setClean(on) {
    try { localStorage.setItem('dpeClean', on ? '1' : '0'); } catch (e) {}
    document.documentElement.classList.toggle('clean', on);
  }
  document.documentElement.classList.toggle('clean', clean());
  function logos() {
    return '<div class="logos"><img src="course/images/logos/dict.png" alt="DICT"><img src="course/images/logos/bir.png" alt="Bureau of Internal Revenue"><img class="sd" src="course/images/logos/serial-disruptors.png" alt="Serial Disruptors"></div>';
  }
  function topbar() {
    var p = S.profile;
    return '<header class="top"><div class="wrap"><a class="brand" href="#/"><span>DPE</span><span class="full"> · Digital Productivity Essentials</span></a>' +
      (p ? '<span class="who">' + esc(p.first_name) + (isAdmin() ? '<span class="fac"> · facilitator</span>' : isViewer() ? ' · preview' : '') + '</span>' +
        (isAdmin() ? '<a class="btn-top fac" href="#/people">People</a>' + toolsBtn() : '') +
        '<button id="signout">Sign out</button>' : '<a class="btn-top" href="#/login">Sign in</a>') +
      '</div></header>';
  }
  function bindTop() {
    var so = document.getElementById('signout');
    var tl = document.getElementById('tools');
    if (tl) tl.onclick = function () { setClean(!clean()); tl.setAttribute('aria-pressed', !clean()); tl.innerHTML = toolsIn(); tl.title = clean() ? 'Show my tools' : 'Hide my tools'; tl.setAttribute('aria-label', tl.title); };
    if (so) so.onclick = function () { clearTimers(); sb.auth.signOut({ scope: 'local' }).then(function () { S.profile = null; S.session = null; location.hash = '#/'; route(); }); };
  }
  function render(html) { $app.innerHTML = html; bindTop(); window.scrollTo(0, 0); }

  // ---------- data
  async function loadProfile() {
    var r = await sb.from('profiles').select('*').eq('id', S.session.user.id).maybeSingle();
    S.profile = r.data || null;
    if (S.profile) {
      var c = await sb.from('cohorts').select('*').eq('id', S.profile.cohort_id).maybeSingle();
      S.cohort = c.data;
    }
  }
  async function loadState() {
    var cid = S.profile.cohort_id;
    var r = await Promise.all([
      sb.from('topic_state').select('*').eq('cohort_id', cid),
      sb.from('activity_state').select('*').eq('cohort_id', cid),
      sb.from('attempts').select('activity_id,status,score,max_score').eq('user_id', S.profile.id),
      isViewer() ? { data: [] } : sb.from('slide_progress').select('topic_id,last_slide,max_slide,total,updated_at').eq('user_id', S.profile.id)
    ]);
    S.topics = {}; (r[0].data || []).forEach(function (x) { S.topics[x.topic_id] = x; });
    S.acts = {}; (r[1].data || []).forEach(function (x) { S.acts[x.activity_id] = x; });
    S.mine = {}; (r[2].data || []).forEach(function (x) { S.mine[x.activity_id] = x; });
    if (isViewer()) S.mine = S.tries = S.tries || {};
    // where each lesson is up to: this browser's copy, merged with the saved one (another device may be further along)
    S.slides = slidesLocal();
    (r[3].data || []).forEach(function (x) {
      var l = S.slides[x.topic_id], t = Date.parse(x.updated_at) || 0;
      S.slides[x.topic_id] = { last: l && l.t > t ? l.last : x.last_slide, max: Math.max(x.max_slide, l ? l.max : 0), total: x.total || (l && l.total), t: Math.max(t, l ? l.t : 0) };
    });
    if (isAdmin()) await loadClass();
  }
  // facilitator only: who in the class has opened / submitted each activity (admins' own tries don't count)
  async function loadClass() {
    var cid = S.profile.cohort_id;
    var r = await Promise.all([
      sb.from('profiles').select('id,first_name,last_name,position').eq('cohort_id', cid).eq('role', 'participant').order('last_name'),
      sb.from('attempts').select('user_id,activity_id,status,score,max_score,submitted_at').eq('cohort_id', cid)
    ]);
    var ids = {}; S.parts = r[0].data || []; S.parts.forEach(function (p) { ids[p.id] = 1; });
    S.prog = {};   // activity id -> { user id -> attempt }
    (r[1].data || []).forEach(function (x) { if (ids[x.user_id]) (S.prog[x.activity_id] = S.prog[x.activity_id] || {})[x.user_id] = x; });
  }
  function nDone(aid) { var m = S.prog[aid] || {}; return Object.keys(m).filter(function (u) { return m[u].status === 'submitted'; }).length; }
  function topicOpen(tid) { return isViewer() || (S.topics[tid] && S.topics[tid].status === 'open'); }

  // ---------- each person's own lesson progress (not the facilitator's "Mark complete"): slides seen + activities submitted
  function slidesKey() { return 'dpe-slides-' + S.profile.id; }
  function slidesLocal() { try { return JSON.parse(localStorage.getItem(slidesKey()) || '{}') || {}; } catch (e) { return {}; } }
  function saveSlide(tid, n, total) {
    var p = S.slides[tid] || { max: 0 };
    S.slides[tid] = { last: n, max: Math.max(p.max, n), total: total, t: Date.now() };
    try { localStorage.setItem(slidesKey(), JSON.stringify(S.slides)); } catch (e) {}
    if (isViewer()) return;   // preview accounts: this browser only, nothing recorded
    clearTimeout(saveSlide.t[tid]);
    saveSlide.t[tid] = setTimeout(function () { sb.rpc('save_slide', { p_topic: tid, p_slide: n, p_total: total }); }, 1500);
  }
  saveSlide.t = {};
  function lessonState(t) {
    var p = S.slides[t.id], total = (p && p.total) || t.slides || 1, seen = p ? Math.min(p.max, total) : 0;
    var acts = t.activities.filter(function (a) { return a.kind !== 'lab'; });   // labs have their own deadline
    var left = acts.filter(function (a) { return !(S.mine[a.id] && S.mine[a.id].status === 'submitted') && !(S.acts[a.id] && S.acts[a.id].status === 'ended'); });
    var pct = Math.round((seen + acts.length - left.length) / (total + acts.length) * 100);
    var done = !!p && seen >= total && !left.length;
    return { started: !!p, done: done, pct: done ? 100 : Math.min(pct, 99), left: left, slidesDone: seen >= total,
      resume: !p || done ? 0 : seen >= total && left.length ? left[0].slideNo || p.last : p.last };
  }

  // ---------- router
  async function route() {
    clearTimers(); $modal.innerHTML = '';
    var hash = location.hash.replace(/^#\/?/, '');
    if (/^(access_token|error|type=)/.test(hash)) return;   // Supabase is reading a link token
    var parts = hash.split('/'), view = parts[0], arg = decodeURIComponent(parts.slice(1).join('/'));
    if (view === 'reset') return vReset();
    if (!S.session) {
      if (/^(a|deck|video|topic)$/.test(view)) sessionStorage.setItem('dpeGo', location.hash);   // come back here after signing in
      if (view === 'login') return vLogin();
      if (view === 'forgot') return vForgot();
      if (view === 'register') return vRegister();
      return vLanding();
    }
    if (!S.profile) await loadProfile();
    if (!S.profile) return vNoProfile();
    var go = sessionStorage.getItem('dpeGo');
    if (go) { sessionStorage.removeItem('dpeGo'); if (go !== location.hash) { location.hash = go; return; } }
    await loadState();
    if (view === 'a' && ACT[arg]) return vActivity(arg);
    if (view === 'topic' && TOPIC[arg]) return vTopic(arg);
    var sub = arg.split('/');
    if ((view === 'deck' || view === 'video') && TOPIC[sub[0]]) return vViewer(view, sub[0], +sub[1] || 0);
    if (isAdmin()) {
      if (view === 'present' && TOPIC[sub[0]]) return vPresent(sub[0], +sub[1] || 0);
      if (view === 'results' && TOPIC[arg]) return vResults(arg);
      if (view === 'people') return vPeople();
      if (view === 'who' && ACT[arg]) return vWho(arg);
    }
    return vHome();
  }

  // ---------- landing, privacy, registration, sign in
  // the activity a signed-out participant was heading to (from an activity QR or link), if any
  function pendingAct() { var go = sessionStorage.getItem('dpeGo') || ''; var k = go.slice(4); return go.indexOf('#/a/') === 0 && ACT[k] ? ACT[k].a : null; }
  async function vLanding() {
    var code = sessionStorage.getItem('dpeJoin') || '';
    var cname = code ? (await sb.rpc('check_join_code', { p_code: code })).data : null;
    var act = pendingAct();   // scanned an activity QR while signed out: most are registered already, so sign in comes first
    render(topbar() +
      '<section class="hero"><div class="narrow"><p class="kicker">DICT · ILCDB training for BIR Misamis Oriental</p>' +
      '<h1>Digital Productivity <span>Essentials</span></h1>' +
      '<p>Welcome! This is your course home for the next two days: slides, videos and the activities you\'ll do with us live.</p>' +
      logos() + '</div></section>' +
      '<main class="narrow" style="margin-top:-18px;padding-bottom:40px">' +
      (act ? '<div class="card stack" style="margin-bottom:16px"><h2>Open the activity</h2><p style="margin:0;font-weight:700">' + esc(act.title) + '</p><p class="muted" style="margin:0">Sign in with the email and password you registered with, and it opens right away.</p>' +
        '<a class="btn primary block" href="#/login">Sign in</a></div>' : '') +
      '<div class="card stack" data-form>' +
      (cname ? '<h2>' + (act ? 'New here? ' : '') + 'Join ' + esc(cname) + '</h2><p class="muted">Class code <b>' + esc(code.toUpperCase()) + '</b>. It takes about a minute.</p>' +
        '<div class="err" id="err"></div><button class="btn ' + (act ? '' : 'primary ') + 'block" id="start">' + (act ? 'Register' : 'Get started') + '</button>'
        : '<h2>' + (act ? 'New here? Join the class' : 'Join the class') + '</h2><p class="muted">Scan the QR code on the facilitator\'s screen, or type the class code.</p>' +
        '<div class="field"><label class="f" for="code">Class code</label><input id="code" autocomplete="off" autocapitalize="characters" value="' + esc(code) + '"></div>' +
        '<div class="err" id="err"></div><button class="btn ' + (act ? '' : 'primary ') + 'block" id="start">Continue</button>') +
      (act ? '' : '<p class="small muted center">Already registered? <a href="#/login">Sign in</a></p>') + '</div></main>');
    document.getElementById('start').onclick = async function () {
      var inp = document.getElementById('code');
      if (inp) {
        var c = inp.value.trim();
        if (!c) { fieldErrors([{ id: 'code', msg: 'Please type the class code from the facilitator\'s screen.' }]); return; }
        // the letter O and zero look alike: try the code as typed, then with them swapped
        var tries = [c, c.replace(/0/g, 'O'), c.replace(/[oO]/g, '0')].filter(function (x, k, all) { return all.indexOf(x) === k; }), r;
        for (var k = 0; k < tries.length; k++) { r = await sb.rpc('check_join_code', { p_code: tries[k] }); if (r.data) { c = tries[k]; break; } }
        if (!r.data) { fieldErrors([{ id: 'code', msg: 'That code doesn\'t match a class. Check the facilitator\'s screen.' }]); return; }
        sessionStorage.setItem('dpeJoin', c);
      }
      privacy(function () { sessionStorage.setItem('dpePrivacy', C.privacyVersion); location.hash = '#/register'; }, function () {
        var e = document.getElementById('err') || document.querySelector('[data-form] .err');
        if (e) e.textContent = 'You need to agree to the privacy terms before you can register. Questions? Ask the facilitator.';
      });
    };
  }

  function privacy(onAgree, onDecline) {
    $modal.innerHTML = '<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="pv-t">' +
      '<h2 id="pv-t">Data privacy agreement</h2>' +
      '<p>To take part in this course, we collect your <b>name, email, organization and position</b>, and the <b>answers and files</b> you submit in the activities.</p>' +
      '<ul><li><b>Why:</b> to run the course, follow your progress and prepare your certificate. Only the facilitator sees your answers and files.</li>' +
      '<li><b>Who handles it:</b> the course facilitator, for DICT ILCDB, which runs this training.</li>' +
      '<li><b>Shared with:</b> DICT ILCDB gets your name, organization and completion for its records and certificates. The data is stored with Supabase, a secure cloud service (servers in Singapore). It is never sold or shared with anyone else.</li>' +
      '<li><b>How long:</b> kept until the training ends and for <b>up to 1 year after</b>, then deleted.</li>' +
      '<li><b>Your rights:</b> under the Data Privacy Act of 2012 (RA 10173) you can ask to see, correct or delete your data, and you can complain to the National Privacy Commission.</li>' +
      '<li><b>Contact:</b> ' + esc(C.privacyContact) + '</li></ul>' +
      '<div class="row mt-3" style="justify-content:flex-end"><button class="btn" id="pv-no">Not now</button><button class="btn primary" id="pv-yes">I agree</button></div>' +
      '</div></div>';
    var dlg = $modal.querySelector('.modal');
    var off = modalKeys(dlg, function () { $modal.innerHTML = ''; if (onDecline) onDecline(); });
    dlg.setAttribute('tabindex', '-1'); dlg.focus(); dlg.scrollTop = 0;   // start at the top of the text, not on "I agree"
    document.getElementById('pv-no').onclick = function () { off(); $modal.innerHTML = ''; if (onDecline) onDecline(); };
    document.getElementById('pv-yes').onclick = function () { off(); $modal.innerHTML = ''; onAgree(); };
  }

  function pwField(id, label, hint) {
    return '<div class="field"><label class="f" for="' + id + '">' + label + '</label><div class="pw"><input id="' + id + '" type="password" autocomplete="' +
      (id === 'pw' || id === 'pw2' || id === 'np' ? 'new-password' : 'current-password') + '"' + (hint ? ' aria-describedby="' + id + '-hint"' : '') + '><button type="button" data-show="' + id + '" aria-label="Show password">Show</button></div>' +
      (hint ? '<div class="hint" id="' + id + '-hint">' + hint + '</div>' : '') + '</div>';
  }
  // too easy to guess: under 8 characters, one repeated character, or only digits/letters in a row
  function weakPw(p) {
    return p.length < 8 ? 'Your password needs at least 8 characters.'
      : /^(.)\1+$/.test(p) || /^(0?123456789?0?|password\d*|qwerty\w*|abcdefgh\w*)$/i.test(p) ? 'That password is too easy to guess. Try a few words with a number.' : '';
  }
  function bindShow() {
    document.querySelectorAll('[data-show]').forEach(function (b) {
      b.onclick = function () { var i = document.getElementById(b.dataset.show); i.type = i.type === 'password' ? 'text' : 'password'; b.textContent = i.type === 'password' ? 'Show' : 'Hide'; b.setAttribute('aria-label', b.textContent + ' password'); };
    });
  }

  function vRegister() {
    var code = sessionStorage.getItem('dpeJoin');
    if (!code) { location.hash = '#/'; return; }
    if (sessionStorage.getItem('dpePrivacy') !== C.privacyVersion) { privacy(function () { sessionStorage.setItem('dpePrivacy', C.privacyVersion); vRegister(); }); return vLanding(); }
    render(topbar() + '<main class="narrow page"><div class="card" data-form>' +
      '<h2>Register</h2><p class="muted small">Class code ' + esc(code.toUpperCase()) + '</p>' +
      '<div class="note blue">Type your name <b>exactly as it should appear on your certificate</b>.</div>' +
      '<div class="cols2"><div class="field"><label class="f" for="fn">First name</label><input id="fn" autocomplete="given-name" aria-describedby="fn-hint"><div class="hint" id="fn-hint">Add your middle initial if you use one, e.g. Ana M.</div></div>' +
      '<div class="field"><label class="f" for="ln">Last name</label><input id="ln" autocomplete="family-name"></div></div>' +
      '<div class="hint" id="cert">Certificate name: <b>…</b></div><div class="hint">Check the spelling: only the facilitator can change it later.</div>' +
      '<div class="field"><label class="f" for="em">Email</label><input id="em" type="email" autocomplete="email" inputmode="email"><div class="hint">Used to recover your password, so use one you can open.</div></div>' +
      '<div class="field"><label class="f" for="org">Organization</label><input id="org" value="' + esc(C.defaultOrganization) + '"></div>' +
      '<div class="field"><label class="f" for="pos">Position</label><input id="pos" autocomplete="organization-title"></div>' +
      pwField('pw', 'Create a password', 'At least 8 characters. A few words with a number is easy to remember.') +
      pwField('pw2', 'Type the password again') +
      '<div class="err" id="err"></div>' +
      '<button class="btn primary block mt-3" id="go">Create my account</button>' +
      '<p class="small muted center">Already registered? <a href="#/login">Sign in</a></p></div></main>');
    bindShow();
    var $ = function (id) { return document.getElementById(id); };
    function cert() { $('cert').innerHTML = 'Certificate name: <b>' + (esc(($('fn').value + ' ' + $('ln').value).trim()) || '…') + '</b>'; }
    $('fn').oninput = cert; $('ln').oninput = cert;
    // all-lowercase or ALL-CAPS names become Title Case (mixed case is left as typed)
    ['fn', 'ln'].forEach(function (id) {
      $(id).onblur = function () {
        var x = $(id).value.trim();
        if (x && (x === x.toLowerCase() || x === x.toUpperCase())) { $(id).value = x.toLowerCase().replace(/(^|[\s\-'.])(\S)/g, function (m, a, c) { return a + c.toUpperCase(); }); cert(); }
      };
    });
    $('go').onclick = async function () {
      var v = { fn: $('fn').value.trim(), ln: $('ln').value.trim(), em: $('em').value.trim().toLowerCase(),
        org: $('org').value.trim(), pos: $('pos').value.trim(), pw: $('pw').value, pw2: $('pw2').value };
      var bad = [];
      if (!v.fn) bad.push({ id: 'fn', msg: 'Please type your first name.' });
      if (!v.ln) bad.push({ id: 'ln', msg: 'Please type your last name.' });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.em)) bad.push({ id: 'em', msg: 'Please type a valid email.' });
      if (!v.org) bad.push({ id: 'org', msg: 'Please type your organization.' });
      if (!v.pos) bad.push({ id: 'pos', msg: 'Please type your position.' });
      if (weakPw(v.pw)) bad.push({ id: 'pw', msg: weakPw(v.pw) });
      else if (v.pw !== v.pw2) bad.push({ id: 'pw2', msg: 'The two passwords don\'t match.' });
      $('err').textContent = ''; if (fieldErrors(bad)) return;
      review(v, function () { create(v); });
    };
    // one last look before the account is made: the name goes on the certificate, the email is how they sign in
    function review(v, onOk) {
      var row = function (k, x) { return '<div><dt>' + k + '</dt><dd>' + esc(x) + '</dd></div>'; };
      $modal.innerHTML = '<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="rv-t">' +
        '<h2 id="rv-t">Check your details</h2><p class="muted">Please check each one again. Only the facilitator can change them once your account is made.</p>' +
        '<dl class="review">' + row('Name on your certificate', v.fn + ' ' + v.ln) + row('Email (you sign in with this)', v.em) + row('Organization', v.org) + row('Position', v.pos) + '</dl>' +
        '<div class="row mt-3" style="justify-content:flex-end"><button class="btn" id="rv-edit">Edit</button><button class="btn primary" id="rv-ok">Continue</button></div></div></div>';
      var close = function () { off(); $modal.innerHTML = ''; };
      var off = modalKeys($modal.querySelector('.modal'), function () { $modal.innerHTML = ''; $('fn').focus(); });
      document.getElementById('rv-edit').onclick = function () { close(); $('fn').focus(); };
      document.getElementById('rv-ok').onclick = function () { close(); onOk(); };
    }
    async function create(v) {
      var btn = $('go'); btn.disabled = true; btn.textContent = 'Creating your account…';
      var r = await sb.auth.signUp({ email: v.em, password: v.pw, options: { emailRedirectTo: BASE, data: {
        first_name: v.fn, last_name: v.ln, organization: v.org, position: v.pos, join_code: code, privacy_version: C.privacyVersion } } });
      if (r.error) {
        btn.disabled = false; btn.textContent = 'Create my account';
        if (/already registered/i.test(r.error.message)) { fieldErrors([{ id: 'em', html: 'This email already has an account. <a href="#/login">Sign in instead</a>.' }]); return; }
        $('err').textContent = /database error/i.test(r.error.message) ? 'We couldn\'t register you with this class code. Check the code and try again.' : errMsg(r.error);
        return;
      }
      if (!r.data.session) { render(topbar() + '<main class="narrow page"><div class="card"><h2>Check your email</h2><p>Open the link we sent to <b>' + esc(v.em) + '</b>, then sign in.</p></div></main>'); return; }
      S.session = r.data.session; sessionStorage.removeItem('dpeJoin');
      toast('Welcome, ' + v.fn + '!'); location.hash = sessionStorage.getItem('dpeGo') || '#/'; route();
    }
  }

  function vLogin() {
    var act = pendingAct();
    render(topbar() + '<main class="narrow page"><div class="card" data-form><h2>Sign in</h2>' +
      (act ? '<p class="muted">After you sign in, this opens: <b>' + esc(act.title) + '</b></p>' : '') +
      '<div class="field"><label class="f" for="em">Email</label><input id="em" type="email" autocomplete="email" inputmode="email"></div>' +
      pwField('pwl', 'Password') + '<div class="err" id="err"></div>' +
      '<button class="btn primary block mt-3" id="go">Sign in</button>' +
      '<p class="small center"><a href="#/forgot">Forgot your password?</a> · <a href="#/">New here? Join the class</a></p></div></main>');
    bindShow();
    document.getElementById('go').onclick = async function () {
      var em = document.getElementById('em').value.trim(), pw = document.getElementById('pwl').value, bad = [];
      if (!em) bad.push({ id: 'em', msg: 'Please type your email.' });
      if (!pw) bad.push({ id: 'pwl', msg: 'Please type your password.' });
      if (fieldErrors(bad)) return;
      var r = await sb.auth.signInWithPassword({ email: em, password: pw });
      if (r.error) { document.getElementById('err').textContent = /invalid/i.test(r.error.message) ? 'Wrong email or password.' : errMsg(r.error); return; }
      S.session = r.data.session; location.hash = sessionStorage.getItem('dpeGo') || '#/'; route();
    };
  }

  function vForgot() {
    render(topbar() + '<main class="narrow page"><div class="card" data-form><h2>Reset your password</h2>' +
      '<p class="muted">We\'ll email you a link to set a new password.</p>' +
      '<div class="field"><label class="f" for="em">Email</label><input id="em" type="email" inputmode="email"></div><div class="err" id="err"></div>' +
      '<button class="btn primary block mt-3" id="go">Send the link</button><p class="small center"><a href="#/login">Back to sign in</a></p></div></main>');
    document.getElementById('go').onclick = async function () {
      var em = document.getElementById('em').value.trim();
      if (fieldErrors(em ? [] : [{ id: 'em', msg: 'Please type the email you registered with.' }])) return;
      var r = await sb.auth.resetPasswordForEmail(em, { redirectTo: BASE });
      if (r.error) { document.getElementById('err').textContent = errMsg(r.error); return; }
      this.disabled = true; this.textContent = 'Sent. Check your email (and spam folder).';
    };
  }

  function vReset() {
    render(topbar() + '<main class="narrow page"><div class="card" data-form><h2>Set a new password</h2>' +
      pwField('np', 'New password', 'At least 8 characters.') + '<div class="err" id="err"></div>' +
      '<button class="btn primary block mt-3" id="go">Save password</button></div></main>');
    bindShow();
    document.getElementById('go').onclick = async function () {
      var p = document.getElementById('np').value;
      if (weakPw(p)) { document.getElementById('err').textContent = weakPw(p); return; }
      var r = await sb.auth.updateUser({ password: p });
      if (r.error) { document.getElementById('err').textContent = errMsg(r.error) + ' Open the link from your email again.'; return; }
      toast('Password saved'); location.hash = '#/'; route();
    };
  }

  function vNoProfile() {
    render(topbar() + '<main class="narrow page"><div class="card"><h2>Almost there</h2><p>Your account has no class yet. Scan the class QR code again, or ask the facilitator.</p></div></main>');
  }

  // ---------- home (participants; the facilitator gets the same page plus her .fac controls)
  function actLink(a) {
    var mine = S.mine[a.id], st = S.acts[a.id];
    if (isAdmin()) {
      var d = nDone(a.id), n = S.parts.length, lv = answering(a.id);
      return actRow('#/who/' + a.id, a.title, n && d === n ? 'done' : lv ? 'ans' : '', (lv ? ico('hand') + ' Open for answers · ' : '') + d + ' of ' + n + ' done');
    }
    var pc = mine && mine.max_score ? Math.round(mine.score / mine.max_score * 100) : null;
    var sub = mine && mine.status === 'submitted';
    if (isViewer()) return actRow('#/a/' + a.id, a.title, sub ? 'done' : '', sub ? ico('check') + ' Tried' + (pc == null ? '' : ' · ' + pc + '%') : 'Try it');
    return actRow('#/a/' + a.id, a.title,
      sub ? (pc == null || pc >= 75 ? 'done' : '') : answering(a.id) ? 'ans' : '',
      sub ? ico('check') + ' Done' + (pc == null ? '' : ' · ' + pc + '%') : answering(a.id) ? ico('hand') + ' Open for answers · ' + (mine ? 'Continue' : 'Start now') : mine ? 'Not submitted' : '');
  }
  // an activity row: the title gets the full width, its status sits on a small line under it
  function actRow(href, title, cls, meta) {
    return '<a href="' + href + '" title="' + esc(title) + '"><span class="at"><span>' + esc(title) + '</span>' + (meta ? '<span class="am ' + cls + '">' + meta + '</span>' : '') +
      '</span><span class="chev" aria-hidden="true">›</span></a>';
  }
  // topic picture, same as the course page cards (course/images/thumbs/1-1.jpg)
  function thumb(id) { return '<img src="course/images/thumbs/' + id.replace('.', '-') + '.jpg" alt="" loading="lazy">'; }
  // a topic card: picture, summary (2 lines + See more), Open / Play video and the activities once the topic is open
  function topicCard(t, adm, deckView) {
    var on = topicOpen(t.id), go = on || adm;   // the facilitator can open a closed topic's slides to preview them
    var mk = on ? topicMark(t.id) : '', live = mk === 'live';   // live = the topic being discussed now; done = the facilitator marked it complete
    var chip = !on ? '<span class="chip">' + ico('lock') + ' ' + (adm ? 'Closed' : 'Opens later') + '</span>' : live ? '<span class="chip live">' + ico('dot') + ' Live</span>' : mk === 'done' ? '<span class="chip done">' + ico('check') + (adm ? ' Completed' : ' Discussed') + '</span>' : '';
    return '<div class="topic' + (on ? ' is-open' : ' locked') + (live ? ' has-live' : '') + '">' +
      (go ? '<a class="cover" href="' + deckView + t.id + '" tabindex="-1" aria-hidden="true">' : '<div class="cover">') + thumb(t.id) +
      '<span class="num">' + t.id + '</span>' + chip + (go ? '</a>' : '</div>') +
      '<div class="t"><h4 title="' + esc(t.title) + '">' + esc(t.title) + '</h4></div>' +
      '<p class="dur">' + ico('clock') + ' ' + esc(t.dur) + (t.video ? '<span class="muted"> · video ' + t.video + '</span>' : '') + '</p>' +
      '<p class="sum">' + esc(t.desc) + '</p><button type="button" class="more" data-more="' + t.id + '">See more</button>' +
      (on && !adm ? progLine(lessonState(t)) : '') +
      (go ? '<div class="go">' + openBtn(t, adm, on, deckView) + (t.video ? '<a class="btn" href="#/video/' + t.id + '">' + ico('play') + ' Play video</a>' : '') + '</div>' +
        (t.activities.length ? '<div class="acts">' + t.activities.map(actLink).join('') + '</div>' : '') : '') +
      (adm ? '<div class="fac facfoot"><label class="switch"><input type="checkbox" role="switch" data-tog="' + t.id + '"' + (on ? ' checked' : '') + '>' +
        '<span class="sl" aria-hidden="true"></span><span>' + (on ? 'Open to class' : 'Closed') + '</span></label><a class="rlink" href="#/results/' + t.id + '">Results ›</a></div>' : '') +
      '</div>';
  }
  function progLine(ls) {
    return '<div class="lprog' + (ls.done ? ' done' : '') + '"><span class="tr"><i style="width:' + ls.pct + '%"></i></span><span class="lbl">' +
      (ls.done ? ico('check') + ' Completed' : !ls.started ? 'Not started' : ls.pct + '% done' + (ls.slidesDone && ls.left.length ? ' · ' + ls.left.length + ' activit' + (ls.left.length > 1 ? 'ies' : 'y') + ' left' : '')) + '</span></div>';
  }
  // Open (never opened) → Resume (back to the slide you left) → Review (from the start, once every slide and activity is done)
  function openBtn(t, adm, on, deckView) {
    if (adm || !on) return '<a class="btn' + (on ? ' primary' : '') + '" href="' + deckView + t.id + '">Open</a>';
    var ls = lessonState(t);
    return '<a class="btn primary" href="' + deckView + t.id + (ls.resume > 1 ? '/' + ls.resume : '') + '">' + (ls.done ? 'Review' : ls.started ? 'Resume' : 'Open') + '</a>';
  }
  // See more: the topic's synopsis and parts
  function topicInfo(tid, from) {
    var t = TOPIC[tid].t, m = TOPIC[tid].m;
    $modal.innerHTML = '<div class="modal-back" id="ti-back"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="ti-t">' +
      '<p class="kicker">' + esc(m.n + ' · Topic ' + t.id + ' · ' + t.dur + (t.video ? ' · video ' + t.video : '')) + '</p><h2 id="ti-t">' + esc(t.title) + '</h2>' +
      '<h3 class="mh">Synopsis</h3><p>' + esc(t.desc) + '</p>' +
      (t.parts && t.parts.length ? '<h3 class="mh">Parts</h3><ul>' + t.parts.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
      (t.activities.length ? '<h3 class="mh">Activities</h3><ul>' + t.activities.map(function (a) { return '<li>' + esc(a.title) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="row mt-3" style="justify-content:flex-end"><button class="btn primary" id="ti-x">Close</button></div></div></div>';
    var close = function () { off(); $modal.innerHTML = ''; if (from && from.isConnected) from.focus(); };
    var off = modalKeys($modal.querySelector('.modal'), function () { $modal.innerHTML = ''; if (from && from.isConnected) from.focus(); });
    document.getElementById('ti-x').onclick = close;
    document.getElementById('ti-back').onclick = function (e) { if (e.target === this) close(); };
  }
  // home hero: the course, as on the course index page, then a strip for you: the greeting, your progress and your next lesson
  function homeHero() {
    var p = S.profile, adm = isAdmin(), vw = isViewer(), all = [].concat.apply([], CAT.map(function (m) { return m.topics; }));
    var hrs = CAT.reduce(function (n, m) { return n + parseFloat(m.hours); }, 0);
    var labs = all.reduce(function (n, t) { return n + t.activities.filter(function (a) { return a.kind === 'lab'; }).length; }, 0);
    var sub, n, lbl, go = '';
    if (adm) {
      n = all.filter(function (t) { return topicMark(t.id) === 'done'; }).length;
      sub = 'Facilitator · ' + esc(S.cohort ? S.cohort.name : '');
      lbl = n + ' of ' + all.length + ' topics discussed with the class';
    } else {
      var open = all.filter(function (t) { return topicOpen(t.id); }), next = null, nextLs = null;
      n = 0;
      open.forEach(function (t) {
        var ls = lessonState(t);
        if (ls.done) n++;
        else if (!next || (ls.started && !nextLs.started)) { next = t; nextLs = ls; }
      });
      sub = vw ? 'Preview access: every topic is open. Try anything; nothing is saved or scored.'
        : esc(S.cohort ? S.cohort.name : '') + ' · Topics open as we reach them in class.';
      lbl = n + ' of ' + all.length + ' lessons completed' + (!vw && open.length < all.length ? ' · ' + open.length + ' open so far' : '');
      if (next) go = '<a class="btn gold" href="#/deck/' + next.id + (nextLs.resume > 1 ? '/' + nextLs.resume : '') + '">' + (nextLs.started ? 'Resume ' : 'Start ') + next.id + ' ' + ico('arrow-right') + '</a>';
    }
    return '<section class="hero"><div class="wrap">' +
      '<div class="partners" aria-label="Partners">' +
        '<figure><img class="dict" src="course/images/logos/dict.png" alt="DICT logo"><figcaption>Organizer<b>DICT</b></figcaption></figure>' +
        '<figure><img src="course/images/logos/bir.png" alt="BIR logo"><figcaption>Participants<b>BIR Misamis Oriental</b></figcaption></figure>' +
        '<figure><img src="course/images/logos/sd-mark.png" alt="Serial Disruptors logo"><figcaption>Partner<b>Serial Disruptors</b></figcaption></figure></div>' +
      '<p class="kicker">DICT ILCDB · ICT Academy · Digital Workforce · Beginner</p>' +
      '<h1>Digital Productivity <span>Essentials</span></h1>' +
      '<p class="lede">Computers and the internet, word processing, spreadsheets and presentations, with everyday AI used safely and responsibly. Built for the women and men of BIR Misamis Oriental, at the office and at home.</p>' +
      '<p class="rp">Resource Person: <b>Engr. Ronelle Pabellan</b> · Fully online · Course syllabus v1.0</p>' +
      '<div class="stats"><div><b>' + hrs + '</b><span>training hours</span></div><div><b>' + CAT.length + '</b><span>modules</span></div>' +
        '<div><b>' + all.length + '</b><span>topic decks</span></div><div><b>' + labs + '</b><span>hands-on labs</span></div></div>' +
      '<div class="me"><div class="mt"><h2>Hi, <span>' + esc(p.first_name) + '</span></h2><p>' + sub + '</p></div>' + go +
        '<div class="mbar" role="progressbar" aria-valuemin="0" aria-valuemax="' + all.length + '" aria-valuenow="' + n + '" aria-label="' + esc(lbl) + '"><i style="width:' + Math.round(n / all.length * 100) + '%"></i></div>' +
        '<p class="ml">' + lbl + '</p></div>' +
      '</div></section>';
  }
  function vHome() {
    clearTimers();   // views that re-render themselves must not stack their refresh timers
    var p = S.profile, adm = isAdmin(), deckView = adm ? '#/present/' : '#/deck/';
    var joinUrl = adm && BASE + '?join=' + encodeURIComponent(S.cohort.join_code);
    var html = topbar() + homeHero() + '<main class="wrap" style="padding-bottom:48px">';
    if (adm) html += '<div class="card facbar fac mt-3"><span class="fk">Only you see this</span><span>Class code <b class="code">' + esc(S.cohort.join_code) + '</b></span>' +
      '<span><b id="nreg">…</b> registered</span><span class="row"><button class="btn small gold" id="full">Show join QR</button><button class="btn small" id="cpj">Copy join link</button></span></div>';
    // Live now: the topic being discussed, and any of its activities that are open for answers
    var lt = liveTopic(), ans = Object.keys(S.acts).filter(function (k) { return answering(k) && (adm || !(S.mine[k] && S.mine[k].status === 'submitted')); });
    var ansHtml = ans.map(function (k) {
      return adm ? '<a href="#/who/' + k + '">' + ico('hand') + '<span>Open for answers: <b>' + esc(ACT[k].a.title) + '</b></span><span class="am">' + nDone(k) + ' of ' + S.parts.length + ' done</span><span class="chev" aria-hidden="true">›</span></a>'
        : '<a href="#/a/' + k + '">' + ico('hand') + '<span>' + (S.mine[k] ? 'Continue' : 'Answer now') + ': <b>' + esc(ACT[k].a.title) + '</b></span><span class="chev" aria-hidden="true">›</span></a>';
    }).join('');
    if (lt && TOPIC[lt]) {
      var LT = TOPIC[lt].t;
      html += '<div class="card livenow mt-3"><a class="lnimg" href="' + deckView + lt + '" tabindex="-1" aria-hidden="true">' + thumb(lt) + '</a><div class="lnb">' +
        '<p class="lk">' + ico('dot') + ' Live now</p><h3>' + lt + ' ' + esc(LT.title) + '</h3>' +
        '<div class="row"><a class="btn primary" href="' + deckView + lt + '">' + (adm ? 'Present' : 'Open slides') + '</a>' + (LT.video ? '<a class="btn" href="#/video/' + lt + '">' + ico('play') + ' Play video</a>' : '') +
        (adm ? '<button class="btn fac" id="ln-done">' + ico('check') + ' Mark complete</button>' : '') + '</div>' +
        (ansHtml ? '<div class="anslist">' + ansHtml + '</div>' : '') + '</div></div>';
    } else {
      if (ansHtml) html += '<div class="card livenow mt-3"><div class="lnb"><p class="lk ans">' + ico('hand') + ' Open for answers</p><div class="anslist">' + ansHtml + '</div></div></div>';
      if (adm) html += '<div class="card facbar fac mt-3"><span class="fk">Live now</span><span>No live topic. Open a topic\'s slides and press <b>Start as live topic</b>.</span></div>';
    }
    // every topic as a card, grouped by day, then module; closed ones are greyed out but their summary stays readable
    var secs = [];
    CAT.forEach(function (m, mi) {
      var sp = DAY_SPLIT[m.id], cut = sp ? m.topics.findIndex(function (t) { return t.id === sp.at; }) : -1;
      if (cut > 0) {
        secs.push({ m: m, mi: mi, day: 'Day 1', part: 'Part 1', hours: sp.hours[0], topics: m.topics.slice(0, cut) });
        secs.push({ m: m, mi: mi, day: 'Day 2', part: 'Part 2', hours: sp.hours[1], topics: m.topics.slice(cut) });
      } else secs.push({ m: m, mi: mi, day: m.day, hours: m.hours, topics: m.topics });
    });
    secs.forEach(function (s, i) {
      if (!i || secs[i - 1].day !== s.day) {
        var day = secs.filter(function (x) { return x.day === s.day; }), ts = [].concat.apply([], day.map(function (x) { return x.topics; }));
        var h = day.reduce(function (n, x) { return n + parseFloat(x.hours); }, 0);
        html += '<div class="dayhead"><h2>' + esc(s.day) + '</h2><span>' + ico('clock') + ' ' + h + ' hours · topics ' + ts[0].id + ' to ' + ts[ts.length - 1].id +
          ' · the day ends after <b>' + ts[ts.length - 1].id + '</b></span></div>';
      }
      var m = s.m, nOpen = s.topics.filter(function (t) { return topicOpen(t.id); }).length;
      html += '<section class="modsec" style="--c:var(--m' + (s.mi + 1) + ')"><div class="modhead"><span class="k">' + esc(m.n + (s.part ? ' · ' + s.part : '') + ' · ' + s.day) + '</span><span class="hrs">' + ico('clock') + ' ' + esc(s.hours) + '</span>' +
        '<h2>' + esc(m.title) + '</h2><span class="small muted">' + s.topics.length + ' topics' + (s.part ? ' (' + s.topics[0].id + ' to ' + s.topics[s.topics.length - 1].id + ')' : '') + ' · ' + (nOpen ? nOpen + ' open' : 'opens later') + '</span></div>' +
        '<div class="topics">' + s.topics.map(function (t) { return topicCard(t, adm, deckView); }).join('') + '</div></section>';
    });
    var hy = +sessionStorage.getItem('dpeHomeY') || 0;
    // bottom of home: the curriculum design DICT provided (Drive Decks/docs/ → course/docs/)
    html += '<section class="docs" aria-label="Curriculum design"><p class="kicker">Curriculum design</p>' +
      '<a class="docl" href="course/docs/CS_DigitalProductivityEssentials_1.0.pdf" target="_blank" rel="noopener"><span class="di">' + ico('file-text') + '</span>' +
      '<span class="dt"><b>Course Syllabus: Digital Productivity Essentials</b><small>DICT ICT Literacy and Competency Development Bureau · Version 1.0 · PDF, 7 pages</small></span>' +
      '<span class="dx">Open ' + ico('external-link') + '</span></a></section>';
    render(html + '<p class="small muted mt-4">Signed in as ' + esc(p.email) + (isViewer() ? ' · preview account' : ' · Certificate name: <b>' + esc(fullName(p)) + '</b> (spelling wrong? Ask the facilitator.)') + '</p></main>');
    if (hy) scrollTo(0, hy);   // back from a lesson or activity: where you were on the list
    document.querySelectorAll('[data-more]').forEach(function (b) { b.onclick = function () { topicInfo(b.dataset.more, b); }; });
    if (adm) {
      document.querySelectorAll('[data-tog]').forEach(function (b) {
        b.onchange = function () { var y = scrollY, id = b.dataset.tog; b.disabled = true; setTopic(id, b.checked).then(function () { vHome(); scrollTo(0, y); var c = document.querySelector('[data-tog="' + id + '"]'); if (c) c.focus({ preventScroll: true }); }); };
      });
      document.getElementById('cpj').onclick = function () { copy(joinUrl); };
      var lnd = document.getElementById('ln-done'); if (lnd) armed(lnd, 'Tap again to mark ' + lt + ' complete', function () { markTopic(lt, 'ended').then(function () { vHome(); }); });
      document.getElementById('full').onclick = function () { qrFull(joinUrl, S.cohort.join_code, 'Scan to register'); count(); };
      var count = async function () {
        var r = await sb.from('profiles').select('id', { count: 'exact', head: true }).eq('cohort_id', S.cohort.id).eq('role', 'participant');
        var n = document.getElementById('nreg'); if (n) n.textContent = r.count == null ? '?' : r.count;
        var f = document.getElementById('fullcount'); if (f && r.count != null) f.textContent = r.count;
      };
      count(); every(5000, function () { if (!document.hidden) count(); });
    }
    // every 15 s (only while the tab is visible): redraw only when something changed, keeping scroll and focus
    var sig = function () { return JSON.stringify([S.topics, S.acts, S.mine, S.prog]); }, was = sig();
    every(15000, async function () {
      if (document.hidden || !S.profile) return;
      await loadState();
      if (!S.profile || !(location.hash === '' || location.hash === '#/') || sig() === was) return;
      var y = scrollY, f = document.activeElement, fk = f && (f.getAttribute('href') ? '[href="' + f.getAttribute('href') + '"]' : f.dataset.more ? '[data-more="' + f.dataset.more + '"]' : f.dataset.tog ? '[data-tog="' + f.dataset.tog + '"]' : null);
      vHome(); scrollTo(0, y);
      if (fk) { var g = document.querySelector(fk); if (g) g.focus({ preventScroll: true }); }
    });
  }

  function vTopic(tid) { location.hash = '#/deck/' + tid; }

  // slides / video viewer (participants and admin)
  function vViewer(kind, tid, slide) {
    var T = TOPIC[tid].t;
    if (!isAdmin() && !topicOpen(tid)) { toast('Topic ' + tid + ' opens later, when the class reaches it.'); location.hash = '#/'; return; }
    var back = sessionStorage.getItem('dpeBack'); sessionStorage.removeItem('dpeBack');
    // participants get course/p/: the same slides with the answers taken out of the page source; DICT viewers see the full decks
    var full = isAdmin() || isViewer();
    var src = kind === 'deck' ? 'course/' + (full ? '' : 'p/') + encodeURIComponent(T.deck) + (full ? '' : '?p=1') + (slide ? '#/' + slide : '')
      : 'course/videos/' + tid + '/index.html';
    render('<div class="present"><div class="pbar vbar">' + (back ? '<a href="' + esc(back) + '">← Activity</a>' : '') + '<a href="#/">' + ico('house') + ' Home</a>' +
      '<span class="t">' + tid + ' ' + esc(T.title) + '</span>' +
      (kind === 'deck' && T.video ? '<a href="#/video/' + tid + '">' + ico('play') + ' Video</a>' : kind === 'video' ? '<a href="#/deck/' + tid + '">Slides</a>' : '') +
      '</div><div class="pbody"><iframe id="view" src="' + src + '" title="' + esc(T.title) + '" allow="autoplay; fullscreen" allowfullscreen></iframe></div>' +
      (kind === 'deck' ? '<div class="pnav"><button id="prev" aria-label="Previous slide">‹ Back</button><span id="pcount" aria-live="polite"></span><button id="next" aria-label="Next slide">Next ›</button>' +
        '<button id="nextl" class="nl" hidden>Next lesson ›</button></div>' : '') +
      '</div>');
    viewTid = tid;
    var $v = document.getElementById('view');
    $v.onload = function () { try { $v.contentWindow.focus(); } catch (e) {} };
    if (kind !== 'deck') return;
    var send = function (k) { $v.contentWindow.postMessage({ type: 'dpe-key', key: k }, '*'); $v.contentWindow.focus(); };
    var $nx = document.getElementById('next'); if (back) $nx.dataset.back = back;
    document.getElementById('prev').onclick = function () { send('ArrowLeft'); };
    $nx.onclick = function () { if ($nx.dataset.end) location.hash = back || '#/'; else send('ArrowRight'); };
    // last slide: a third button to the next lesson (where you left off in it), or "opens later" while the class hasn't reached it
    var all = [].concat.apply([], CAT.map(function (m) { return m.topics; })), nt = all[all.map(function (t) { return t.id; }).indexOf(tid) + 1];
    var $nl = document.getElementById('nextl');
    if (nt && !back) {
      var ok = isAdmin() || topicOpen(nt.id), ls = isAdmin() ? null : lessonState(nt);
      $nl.dataset.ok = ok ? '1' : '';
      $nl.textContent = ok ? 'Next lesson: ' + nt.id + ' ›' : nt.id + ' opens later';
      $nl.title = nt.id + ' ' + nt.title;
      $nl.disabled = !ok;
      $nl.onclick = function () { location.hash = '#/deck/' + nt.id + (ls && ls.resume > 1 ? '/' + ls.resume : ''); };
    }
  }
  // on an activity slide, participants get the activity's status (Done / Pending) and a button to it,
  // drawn by the deck under the slide's own content (dpe.js showAct)
  var viewTid = null;
  function slideAct(n) {
    var $v = document.getElementById('view'); if (!$v || isAdmin()) return;
    var acts = TOPIC[viewTid].t.activities.filter(function (a) { return a.slideNo === n; });
    var html = acts.map(function (a) {
      var mine = S.mine[a.id], sub = mine && mine.status === 'submitted', vw = isViewer();
      var pc = mine && mine.max_score ? Math.round(mine.score / mine.max_score * 100) : null;
      var pill = sub ? '<span class="pill done">' + ico('check') + ' ' + (vw ? 'Tried' : 'Done') + (pc == null ? '' : ' · ' + pc + '%') + '</span>'
        : '<span class="pill pend">' + ico('hourglass') + ' ' + (vw ? 'Not tried yet' : mine ? 'Pending · not submitted' : 'Pending') + '</span>';
      return '<div class="pa ' + (sub ? 'done' : 'pend') + '">' + pill + '<span class="pt"><small>' + (a.kind === 'check' ? 'Quick check' : 'Activity') + ' on this slide</small>' + esc(a.title) + '</span>' +
        '<button type="button" class="go" data-go="#/a/' + esc(a.id) + '">' + (sub ? (vw ? 'Try again' : 'View') : mine ? 'Continue' : vw ? 'Try it' : 'Start') + ' ›</button></div>';
    }).join('');
    $v.contentWindow.postMessage({ type: 'dpe-act', n: n, html: html }, '*');
  }
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'dpe-home') location.hash = '#/';
    if (d.type === 'dpe-go' && /^#\/a\/[\w.-]+$/.test(d.to || '')) location.hash = d.to;
    if (d.type === 'dpe-slide') {
      var c = document.getElementById('pcount'); if (!c) return;
      c.textContent = d.n + ' / ' + d.total;
      var nx = document.getElementById('next'), end = d.n >= d.total;
      document.getElementById('prev').disabled = d.n <= 1;
      slideAct(d.n);
      if (viewTid && /^#\/deck\//.test(location.hash) && !isAdmin()) saveSlide(viewTid, d.n, d.total);
      var nl = document.getElementById('nextl'); if (nl && nl.title) nl.hidden = !end;
      nx.textContent = end ? (nx.dataset.back ? 'Activity ›' : 'Home ›') : 'Next ›'; nx.setAttribute('aria-label', end ? nx.textContent.slice(0, -2) : 'Next slide'); nx.dataset.end = end ? '1' : '';
      // keep the slide in the address, so a reload or the Back button returns to it (without re-rendering)
      var m = location.hash.match(/^#\/(deck|present)\/([\d.]+)/); if (m) history.replaceState(null, '', '#/' + m[1] + '/' + m[2] + '/' + d.n);
    }
  });

  // ---------- activity page (participants)
  async function vActivity(aid) {
    clearTimers();   // views that re-render themselves must not stack their refresh timers
    var tid = ACT[aid].topic, T = TOPIC[tid].t;
    render(topbar() + '<div class="boot">Opening the activity…</div>');
    var sp = (await spec(tid)).activities.find(function (x) { return x.id === aid; });
    var vw = isViewer();
    var r = vw ? { data: S.tries[aid] || { status: 'opened', answers: {} } } : await sb.rpc('touch_attempt', { p_activity: aid, p_topic: tid, p_answers: null });
    if (r.error) {
      render(topbar() + '<main class="narrow page"><div class="card stack"><p class="kicker muted small">' + tid + ' · ' + esc(T.title) + '</p><h2>' + esc(sp.title) + '</h2>' +
        '<p>' + ico('hourglass') + ' Waiting for your facilitator to open this activity. This page will open it by itself.</p><a class="btn" href="#/">Back to home</a></div></main>');
      every(5000, async function () { var t = await sb.rpc('touch_attempt', { p_activity: aid, p_topic: tid, p_answers: null }); if (!t.error) route(); });
      return;
    }
    var at = r.data, done = at.status === 'submitted';
    var key = 'dpe-a-' + S.profile.id + '-' + aid;
    var A = at.answers || {};
    if (!done && !vw) { try { var loc = JSON.parse(localStorage.getItem(key) || 'null'); if (loc && Object.keys(loc).length > Object.keys(A).length) A = loc; } catch (e) {} }
    var fb = at.feedback || {};
    var kindLbl = { task: 'Hands-on', check: 'Quick check', quiz: 'Quiz', lab: 'Lab' }[sp.kind];
    var html = topbar() + '<div class="act-head"><div class="narrow"><div class="kicker">' + tid + ' · ' + esc(kindLbl) + '</div><h1>' + esc(sp.title) + '</h1>' +
      '<div class="timer hide" id="timer"></div></div></div><main class="narrow" style="padding-bottom:24px">';
    if (vw) html += '<div class="card facbar mt-2"><span class="fk">Preview</span><span>Nothing here is saved or scored. ' + (done ? 'Try again to start over.' : 'Check your answers to see the right ones.') + '</span></div>';
    if (done) html += '<div class="card scorebox mt-2"><div class="muted small">' + (vw ? 'Checked ' : 'Submitted ') + when(at.submitted_at) + '</div>' +
      (at.max_score ? '<div class="big">' + Math.round(at.score / at.max_score * 100) + '%</div><div class="muted">' + scoreLine(sp, at) + 'The right answers are below.' +
        (sp.blocks.some(function (b) { return b.type === 'rubric'; }) ? ' Your facilitator scores the rest.' : '') + '</div>'
        : '<div class="big">' + ico('check') + '</div><div class="muted">' + (vw ? 'No automatic score here: in class, the facilitator reviews this work.' : 'Thank you! Your work is in. Your facilitator reviews it.') + '</div>') + '</div>';
    if (sp.intro) html += '<p class="mt-2">' + emo(esc(sp.intro)) + '</p>';
    var aCat = ACT[aid].a;
    if (aCat.slideNo) html += '<p><a class="btn small" id="toslide" href="#/deck/' + tid + '/' + aCat.slideNo + '">' + ico('file-text') + ' See this on the slides</a></p>';
    if (sp.help && sp.help.length && !done) html += '<details class="help"><summary>Stuck? Hints</summary><ul>' + sp.help.map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('') + '</ul></details>';
    sp.blocks.forEach(function (b, i) { html += '<div class="block' + (b.type === 'email' ? ' show' : '') + '" data-b="' + esc(b.id) + '">' + blockHtml(b, A[b.id], fb[b.id], done, i) + '</div>'; });
    html += '</main>';
    // after submitting: the next activity of this topic that isn't done yet
    var nxt = T.activities.filter(function (x) { return x.id !== aid && !(S.mine[x.id] && S.mine[x.id].status === 'submitted'); })[0];
    html += done ? '<div class="savebar done"><div class="narrow"><span class="st">' + (vw ? 'Preview: not saved.' : 'Your answers are saved.') + '</span>' + (vw ? '<button class="btn" id="again">Try again</button>' : '') +
        (nxt ? '<a class="btn" href="#/">Home</a><a class="btn primary" href="#/a/' + nxt.id + '">Next: ' + esc(nxt.title) + ' →</a>' : '<a class="btn primary" href="#/">Back to home</a>') + '</div></div>'
      : '<div class="savebar"><div class="narrow"><span class="st"><b id="prog"></b><br><span id="st">' + (vw ? 'Preview: answers aren\'t saved.' : 'Your answers save automatically.') + '</span></span><button class="btn good" id="submit">' + (vw ? 'Check answers' : 'Submit') + '</button></div></div>';
    render('<div class="actpage">' + html + '</div>');
    var $ts = document.getElementById('toslide'); if ($ts) $ts.onclick = function () { sessionStorage.setItem('dpeBack', '#/a/' + aid); };
    var $ag = document.getElementById('again'); if ($ag) $ag.onclick = function () { delete S.tries[aid]; vActivity(aid); };

    // timer from the facilitator's Open for answers
    // 1 minute left: a reminder. At 0:00 quick checks and quizzes submit what's there; tasks and labs
    // keep going until the facilitator ends them (they often give extra time).
    var st = S.acts[aid], onTimeUp = null;
    if (!done && st && st.status === 'live' && sp.minutes) {
      var end = new Date(st.opened_at).getTime() + (st.duration_min || sp.minutes) * 60000, $t = document.getElementById('timer');
      var warned = (end - Date.now()) / 1000 <= 60, ended = (end - Date.now()) <= 0;
      var tick = function () {
        var left = (end - Date.now()) / 1000; $t.classList.remove('hide'); $t.classList.toggle('over', left <= 0); $t.classList.toggle('soon', left > 0 && left <= 60);
        $t.innerHTML = left > 0 ? ico('timer') + ' ' + clock(left) + ' left' : ico('timer') + ' Time\'s up: finish and submit';
        if (!warned && left <= 60) { warned = true; toast('1 minute left. Submit when you\'re ready.'); }
        if (!ended && left <= 0) { ended = true; if (onTimeUp) onTimeUp(); }
      };
      tick(); every(1000, tick);
    }
    if (done) return;

    // answers: save on change (debounced), keep a local copy, and ping every 15 s
    var dirty = false, saving = false;
    function payload() {
      var out = {};
      sp.blocks.forEach(function (b) { if (A[b.id] != null) out[b.id] = b.type === 'number' ? num(A[b.id]) : A[b.id]; });
      return out;
    }
    // what still needs doing: every question and every lab step (rubric, sample emails and optional ones don't count)
    var needed = sp.blocks.filter(function (b) { return !(b.optional || b.type === 'rubric' || b.type === 'email'); }), flagged = false;
    function blank(b) {
      var v = A[b.id]; return v == null || v === '' || (Array.isArray(v) && !v.length) || (b.type === 'sort' && !Object.keys(v).length);
    }
    function unanswered() {
      return needed.filter(function (b) {
        var v = A[b.id]; return blank(b) || ((b.type === 'sort' ? Object.keys(v) : v).length < (b.items || []).length) || (b.type === 'number' && typeof num(v) !== 'number');
      });
    }
    // sort and steps blocks count each item; everything else counts once
    function units(b) { return b.items ? b.items.length : 1; }
    function left(b) {
      if (b.type === 'sort') return b.items.filter(function (it) { return !A[b.id] || A[b.id][it] == null; }).length;
      return b.type === 'steps' ? b.items.length - (A[b.id] || []).length : 1;
    }
    var total = needed.reduce(function (n, b) { return n + units(b); }, 0);
    function missCount(miss) { return miss.reduce(function (n, b) { return n + left(b); }, 0); }
    function progress() {
      var miss = unanswered(), $p = document.getElementById('prog');
      if ($p) $p.textContent = total ? 'Done ' + (total - missCount(miss)) + ' of ' + total : '';
      if (flagged) sp.blocks.forEach(function (b) {
        var el = document.querySelector('.block[data-b="' + CSS.escape(b.id) + '"]'); if (!el) return;
        el.classList.toggle('missing', miss.indexOf(b) >= 0);
        if (b.type === 'sort') el.querySelectorAll('.sortrow').forEach(function (r, k) { r.classList.toggle('missing', !A[b.id] || A[b.id][b.items[k]] == null); });
        if (b.type === 'steps') el.querySelectorAll('.step').forEach(function (r, k) { r.classList.toggle('missing', (A[b.id] || []).indexOf(k) < 0); });
      });
      var $s = document.getElementById('submit');
      if (!miss.length && $s && $s.classList.contains('armed')) { $s.classList.remove('armed'); $s.textContent = vw ? 'Check answers' : 'Submit'; }
      return miss;
    }
    progress();
    function changed() {
      progress();
      if (vw) return;   // preview: answers stay on this page only
      dirty = true; try { localStorage.setItem(key, JSON.stringify(A)); } catch (e) {}
      document.getElementById('st').textContent = 'Saving…';
      clearTimeout(changed.t); changed.t = setTimeout(save, 1200);
    }
    async function save() {
      if (saving) return; saving = true; dirty = false;
      var s = await sb.rpc('touch_attempt', { p_activity: aid, p_topic: tid, p_answers: payload() });
      saving = false;
      var $st = document.getElementById('st'); if (!$st) return;
      $st.innerHTML = s.error ? 'Not saved yet (connection?). We\'ll keep trying.' : 'Saved ' + ico('check') + ' ' + new Date().toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });
      if (s.error || dirty) later(4000, save);
    }
    if (!vw) every(15000, function () { if (!dirty && !document.hidden) sb.rpc('touch_attempt', { p_activity: aid, p_topic: tid, p_answers: null }); });
    bindBlocks(sp, A, changed);

    var $sub = document.getElementById('submit');
    onTimeUp = function () {
      if (sp.kind !== 'check' && sp.kind !== 'quiz') return;
      if (!sp.blocks.some(function (b) { return b.type !== 'email' && !blank(b); })) { toast('Time\'s up. Answer and submit now.'); return; }
      toast('Time\'s up, so we submitted your answers.'); send();
    };
    $sub.onclick = async function () {
      flagged = true;
      var miss = progress(), missing = missCount(miss);
      if (!sp.blocks.some(function (b) { return b.type !== 'email' && b.type !== 'rubric' && !blank(b); })) {
        var f0 = needed[0] && document.querySelector('.block[data-b="' + CSS.escape(needed[0].id) + '"]');
        if (f0) f0.scrollIntoView({ behavior: 'smooth', block: 'center' });
        document.getElementById('prog').textContent = 'Nothing answered yet'; toast('Answer at least one question first.'); return;
      }
      if (missing && !$sub.classList.contains('armed')) {
        var first = document.querySelector('.block[data-b="' + CSS.escape(miss[0].id) + '"]');
        (first.querySelector('.sortrow.missing,.step.missing') || first).scrollIntoView({ behavior: 'smooth', block: 'center' });
        $sub.classList.add('armed'); $sub.textContent = vw ? 'Check anyway?' : 'Submit anyway?';   // stays armed: a second tap submits
        document.getElementById('prog').textContent = missing + ' not done yet'; return;
      }
      send();
    };
    async function send() {
      if ($sub.disabled) return;
      $sub.disabled = true; $sub.textContent = vw ? 'Checking…' : 'Submitting…';
      if (vw) {
        var c = await sb.rpc('check_attempt', { p_activity: aid, p_answers: payload() });
        if (c.error) { $sub.disabled = false; $sub.textContent = 'Check answers'; toast('Couldn\'t check. Check your connection and try again.'); return; }
        S.tries[aid] = Object.assign({}, c.data, { answers: payload() }); vActivity(aid); return;
      }
      var s = await sb.rpc('submit_attempt', { p_activity: aid, p_topic: tid, p_answers: payload() });
      if (s.error) { $sub.disabled = false; $sub.textContent = 'Submit'; toast(/ended/.test(s.error.message) ? 'This activity has ended.' : 'Couldn\'t submit. Check your connection and try again.'); return; }
      try { localStorage.removeItem(key); } catch (e) {}
      toast('Submitted!'); await loadState(); vActivity(aid);
    }
  }

  // "2 of 3 points." for several questions, "7 of 9 right." for a single sort, nothing for a single question
  function scoreLine(sp, at) {
    var r = function (x) { return Math.round(x * 10) / 10; };
    if (at.max_score > 1) return 'Your score: ' + r(at.score) + ' of ' + at.max_score + ' points. ';
    var srt = sp.blocks.filter(function (b) { return b.type === 'sort'; });
    return srt.length === 1 ? 'You sorted ' + Math.round(at.score * srt[0].items.length) + ' of ' + srt[0].items.length + ' right. ' : '';
  }
  var LETTERS = 'ABCDEFGH';
  var MIME = { pdf: 'application/pdf', doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', odt: 'application/vnd.oasis.opendocument.text',
    ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp' };
  var UPLOAD_ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp';
  var UPLOAD_OK = /\.(png|jpe?g|gif|webp|heic|heif|bmp|pdf|docx?|xlsx?|pptx?|odt|ods|odp)$/i;
  function blockHtml(b, v, f, done, i) {
    var qid = 'q-' + b.id;   // the question text labels its answer controls for screen readers
    var h = b.prompt ? '<p class="p" id="' + qid + '">' + esc(b.prompt) + (b.optional ? ' <span class="tag">optional</span>' : '') + '</p>' : '';
    var key = f && f.key;
    if (b.type === 'steps') {
      v = v || [];
      return '<p class="p">Steps · tick each one as you finish it</p>' + b.items.map(function (it, k) {
        var on = v.indexOf(k) >= 0;
        return '<label class="step' + (on ? ' on' : '') + '"><input type="checkbox" data-k="' + k + '" aria-label="Step ' + (k + 1) + ': ' + esc(it) + '"' + (on ? ' checked' : '') + (done ? ' disabled' : '') + '><span>' + emo(esc(it)) + '</span></label>';
      }).join('');
    }
    if (b.type === 'email') {   // a sample email to read (e.g. the phishing example), not a question
      return '<div class="mailbox"><div class="mbar">' + esc(b.label || 'Sample email') + '</div><dl><dt>From</dt><dd>' + esc(b.from) + '</dd><dt>Subject</dt><dd>' + esc(b.subject) + '</dd></dl>' +
        '<div class="mbody">' + (b.body || []).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') +
        (b.button ? '<p><span class="mbtn">' + esc(b.button) + '</span>' + (b.link ? ' <span class="small muted">links to ' + esc(b.link) + '</span>' : '') + '</p>' : '') +
        (b.attachment ? '<p class="matt">' + ico('paperclip') + ' ' + esc(b.attachment) + '</p>' : '') + '</div></div>';
    }
    if (b.type === 'mcq') {
      v = v || [];
      h += b.multi ? '<p class="hint" style="margin-top:-6px">Pick all that apply.</p>' : '';
      h += '<div role="' + (b.multi ? 'group' : 'radiogroup') + '" aria-labelledby="' + qid + '">' + b.options.map(function (o, k) {
        var on = v.indexOf(k) >= 0, cls = on ? ' on' : '';
        if (key) cls += key.mcq.indexOf(k) >= 0 ? ' right' : on ? ' wrong' : '';
        return '<button type="button" class="opt' + cls + '" data-k="' + k + '"' + (b.multi ? ' aria-pressed="' + on + '"' : ' role="radio" aria-checked="' + on + '"') + (done ? ' disabled' : '') + '><span class="l">' + LETTERS[k] + '</span><span>' + esc(o) + '</span></button>';
      }).join('') + '</div>';
    } else if (b.type === 'number' || b.type === 'short') {
      h += '<input class="in" aria-labelledby="' + qid + '"' + (b.type === 'number' && !done ? ' aria-describedby="' + qid + '-err"' : '') + ' ' + (b.type === 'number' ? 'inputmode="decimal"' : 'autocapitalize="off" autocomplete="off" spellcheck="false"') +
        ' placeholder="' + esc(b.placeholder || (b.type === 'number' ? 'Type a number' : 'Type your answer')) + '" value="' + esc(v == null ? '' : v) + '"' + (done ? ' disabled' : '') + '>' +
        (b.unit ? '<div class="hint">' + esc(b.unit) + '</div>' : '') + (b.type === 'number' && !done ? '<div class="ferr numerr" id="' + qid + '-err" hidden>Type a number using digits, e.g. 6.</div>' : '');
    } else if (b.type === 'sort') {
      v = v || {};
      h += b.items.map(function (it) {
        return '<div class="sortrow"><div class="it">' + esc(it) + '</div><div class="bins" role="radiogroup" aria-label="' + esc(it) + '">' + b.bins.map(function (bn, k) {
          var on = v[it] === k, cls = on ? ' on' : '';
          var mark = '';
          if (key && key.sort) { cls = key.sort[it] === k ? (on ? ' right' : ' on right') : on ? ' wrong' : ''; mark = key.sort[it] === k ? (on ? ico('check') + ' ' : '→ ') : on ? ico('x') + ' ' : ''; }
          return '<button type="button" data-it="' + esc(it) + '" data-k="' + k + '" class="' + cls + '" role="radio" aria-checked="' + on + '"' + (done ? ' disabled' : '') + '>' + mark + esc(bn) + '</button>';
        }).join('') + '</div></div>';
      }).join('');
    } else if (b.type === 'text') {
      h += '<textarea class="in" aria-labelledby="' + qid + '" rows="' + (b.lines || 4) + '" placeholder="' + esc(b.placeholder || 'Type your answer') + '"' + (done ? ' disabled' : '') + '>' + esc(v || '') + '</textarea>';
    } else if (b.type === 'upload') {
      // the native file input is hidden (it is wider than a phone screen); the label is the button
      var fid = 'f-' + b.id;
      h += '<div class="up"><div class="upst">' + (v && v.name ? '<span class="ok">' + ico('check') + ' Uploaded: ' + esc(v.name) + '</span>' : done ? '<span class="muted">No file</span>' : '') + '</div>' +
        (done ? '' : '<div class="row"><input type="file" id="' + fid + '" class="vh" accept="' + UPLOAD_ACCEPT + '"><label class="btn small" for="' + fid + '">' + ico('paperclip') + ' ' + (v && v.name ? 'Replace file' : 'Choose a file') + '</label>' +
          (v && v.name ? '<button type="button" class="btn small" data-rm>Remove</button>' : '') + '</div>' +
          '<div class="hint">Photo, screenshot, PDF or Office file, up to 15 MB.</div><div class="err"></div>') + '</div>';
    } else if (b.type === 'rubric') {
      h = '<p class="p">How your facilitator will score this</p><table class="rub">' + b.criteria.map(function (c) { return '<tr><td>' + esc(c.name) + '</td><td style="text-align:right;white-space:nowrap">' + c.points + ' pts</td></tr>'; }).join('') +
        '<tr><th>Total</th><th style="text-align:right">' + b.criteria.reduce(function (s, c) { return s + c.points; }, 0) + ' pts</th></tr></table>';
    }
    if (done && !f && (b.type === 'text' || b.type === 'steps') && v != null && v !== '' && !(Array.isArray(v) && !v.length))
      h += '<div class="fb got"><b>' + ico('check') + ' Received.</b> Your facilitator reviews this.</div>';
    if (f) {
      var cls = f.points >= 1 ? 'right' : f.points > 0 ? 'part' : 'wrong';
      var ans = key.number != null ? (key.tol ? (key.number - key.tol).toLocaleString('en-PH') + ' to ' + (key.number + key.tol).toLocaleString('en-PH') : Number(key.number).toLocaleString('en-PH'))
        : key.short ? key.short[0] : key.mcq && b.options ? key.mcq.map(function (k) { return LETTERS[k] + '. ' + b.options[k]; }).join(', ') : '';
      var part = b.type === 'sort' ? Math.round(f.points * b.items.length) + ' of ' + b.items.length + ' right' : Math.round(f.points * 100) + '%';
      h += '<div class="fb ' + cls + '"><b>' + (f.points >= 1 ? ico('check') + ' Correct' : f.points > 0 ? 'Partly right: ' + part : ico('x') + ' Not quite') + '</b>' +
        (f.points < 1 && ans ? ' · Answer: <b>' + esc(ans) + '</b>' : '') + (f.why ? '<div>' + esc(f.why) + '</div>' : '') + '</div>';
    }
    return h;
  }

  function bindBlocks(sp, A, changed) {
    sp.blocks.forEach(function (b) {
      var el = document.querySelector('.block[data-b="' + CSS.escape(b.id) + '"]');
      if (b.type === 'steps') el.querySelectorAll('input').forEach(function (cb) {
        cb.onchange = function () {
          var k = +cb.dataset.k, v = (A[b.id] || []).filter(function (x) { return x !== k; });
          if (cb.checked) v.push(k); A[b.id] = v.sort(); cb.closest('.step').classList.toggle('on', cb.checked); changed();
        };
      });
      if (b.type === 'mcq') el.querySelectorAll('.opt').forEach(function (o) {
        o.onclick = function () {
          var k = +o.dataset.k, v = A[b.id] || [];
          if (b.multi) { v = v.indexOf(k) >= 0 ? v.filter(function (x) { return x !== k; }) : v.concat(k); } else v = [k];
          A[b.id] = v.sort();
          el.querySelectorAll('.opt').forEach(function (x) { var on = v.indexOf(+x.dataset.k) >= 0; x.classList.toggle('on', on); x.setAttribute(b.multi ? 'aria-pressed' : 'aria-checked', on); });
          changed();
        };
      });
      if (b.type === 'number' || b.type === 'short' || b.type === 'text') {
        var inp = el.querySelector('input,textarea'); inp.oninput = function () { A[b.id] = inp.value; changed(); };
        if (b.type === 'number') inp.onblur = function () {
          var bad = inp.value.trim() !== '' && typeof num(inp.value) !== 'number';
          el.querySelector('.numerr').hidden = !bad; inp.classList.toggle('bad', bad); inp.setAttribute('aria-invalid', bad);
        };
      }
      if (b.type === 'sort') el.querySelectorAll('.bins button').forEach(function (btn) {
        btn.onclick = function () {
          var v = A[b.id] || {}; v[btn.dataset.it] = +btn.dataset.k; A[b.id] = v;
          btn.parentNode.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === btn); x.setAttribute('aria-checked', x === btn); }); changed();
        };
      });
      if (b.type === 'upload') {
        var fi = el.querySelector('input[type=file]'); if (!fi) return;
        var $st = el.querySelector('.upst'), $e = el.querySelector('.err'), $lb = el.querySelector('label[for="' + fi.id + '"]');
        var rm = function () {
          var x = el.querySelector('[data-rm]'); if (!x) return;
          x.onclick = function () { A[b.id] = null; $st.innerHTML = ''; $lb.innerHTML = ico('paperclip') + ' Choose a file'; x.remove(); changed(); };
        };
        rm();
        fi.onchange = async function () {
          var file = fi.files[0]; fi.value = ''; if (!file) return;
          if (!UPLOAD_OK.test(file.name)) { $e.textContent = 'Please choose a photo, screenshot, PDF or Office file.'; return; }
          if (file.size > 15 * 1024 * 1024) { $e.textContent = 'That file is over 15 MB.'; return; }
          $e.textContent = '';
          if (isViewer()) {   // preview: the file stays on this computer
            A[b.id] = { name: file.name, type: file.type, size: file.size, preview: true };
            $st.innerHTML = '<span class="ok">' + ico('check') + ' Chosen: ' + esc(file.name) + '</span> <span class="muted small">(preview: not uploaded)</span>';
            $lb.innerHTML = ico('paperclip') + ' Replace file'; changed(); return;
          }
          $st.innerHTML = '<span class="muted">Uploading ' + esc(file.name) + '…</span>';
          var path = S.profile.id + '/' + sp.id + '/' + b.id + '-' + Date.now() + '-' + file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
          // the storage bucket only takes images, PDFs and Office files; the type comes from the extension
          var r = await sb.storage.from('outputs').upload(path, file, { upsert: true, contentType: MIME[file.name.split('.').pop().toLowerCase()] });
          if (r.error) { $st.innerHTML = ''; $e.textContent = 'Upload failed: ' + errMsg(r.error); return; }
          A[b.id] = { path: path, name: file.name, type: file.type, size: file.size };
          $st.innerHTML = '<span class="ok">' + ico('check') + ' Uploaded: ' + esc(file.name) + '</span>' +
            (/^image\//.test(file.type) ? '<img class="upthumb" alt="Preview of ' + esc(file.name) + '" src="' + URL.createObjectURL(file) + '">' : '');
          $lb.innerHTML = ico('paperclip') + ' Replace file';
          if (!el.querySelector('[data-rm]')) { $lb.insertAdjacentHTML('afterend', '<button type="button" class="btn small" data-rm>Remove</button>'); rm(); }
          changed();
        };
      }
    });
  }

  function qrFull(url, code, title) {
    var known = document.getElementById('nreg');
    $modal.innerHTML = '<div class="qrfull" id="qf" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div style="font-size:clamp(22px,3vw,36px);font-weight:800">' + esc(title) + '</div>' +
      '<div class="qrbox">' + qr(url) + '</div><div class="code">' + esc(code) + '</div><div class="lnk">' + esc(url.replace(/^https?:\/\//, '')) + '</div>' +
      '<div class="row" style="justify-content:center"><span><b id="fullcount" style="font-size:28px">' + esc(known ? known.textContent : '…') + '</b> registered</span><button class="btn" id="qfc">Copy link</button><button class="btn gold" id="qfx">Close (Esc)</button></div></div>';
    var close = function () { $modal.innerHTML = ''; };
    var off = modalKeys(document.getElementById('qf'), close);
    document.getElementById('qfc').onclick = function () { copy(url); };
    document.getElementById('qfx').onclick = function () { off(); close(); };
  }

  // topic progress: a marker row 'topic:<id>' in activity_state (live = the topic being discussed now, ended = completed)
  function topicMark(tid) { var r = S.acts['topic:' + tid]; return r ? (r.status === 'live' ? 'live' : 'done') : ''; }
  function liveTopic() { var k = Object.keys(S.acts).filter(function (k) { return k.indexOf('topic:') === 0 && S.acts[k].status === 'live'; })[0]; return k ? k.slice(6) : null; }
  // an activity the facilitator has opened for answers (activity_state status 'live')
  function answering(aid) { return !!(ACT[aid] && S.acts[aid] && S.acts[aid].status === 'live'); }
  function nextTopic(tid) { var all = []; CAT.forEach(function (m) { all = all.concat(m.topics); }); var i = all.findIndex(function (t) { return t.id === tid; }); return all[i + 1] || null; }
  async function markTopic(tid, status) {   // 'live' (only one at a time; opens the topic to the class) or 'ended' (completed)
    var cid = S.profile.cohort_id, cur = liveTopic();
    if (status === 'live') {
      if (!topicOpen(tid)) await setTopic(tid, true);
      if (cur && cur !== tid) await sb.from('activity_state').delete().eq('cohort_id', cid).eq('activity_id', 'topic:' + cur);
    }
    var r = await sb.from('activity_state').upsert({ cohort_id: cid, activity_id: 'topic:' + tid, topic_id: tid, status: status, opened_at: new Date().toISOString() });
    if (r.error) { toast(errMsg(r.error)); return false; }
    toast(status === 'live' ? tid + ' is now the live topic' : tid + ' is marked complete');
    await loadState(); return true;
  }
  async function setTopic(tid, open) {
    var r = await sb.from('topic_state').upsert({ cohort_id: S.profile.cohort_id, topic_id: tid, status: open ? 'open' : 'locked', opened_at: open ? new Date().toISOString() : null });
    if (r.error) toast(errMsg(r.error)); else { toast(tid + (open ? ' is open to the class' : ' is closed')); await loadState(); }
  }

  // ---------- presenter: deck + live topic, Mark complete and the answers panel
  function vPresent(tid, slide) {
    var T = TOPIC[tid].t, cid = S.profile.cohort_id, current = null, liveId = null, panelHidden = false;
    var opts = T.activities.map(function (a) { return '<option value="' + a.id + '">' + esc(a.title) + '</option>'; }).join('');
    // the same frame as the participants' slide viewer (#/deck), with the facilitator's controls (.fac) added
    render('<div class="present"><div class="pbar vbar"><a href="#/">' + ico('house') + ' Home</a><span class="t" title="' + tid + ' ' + esc(T.title) + '">' + tid + ' ' + esc(T.title) + '</span>' +
      (T.video ? '<a href="#/video/' + tid + '">' + ico('play') + ' Video</a>' : '') +
      '<span class="fac pfac"><button class="tlive" id="tlive"></button><button class="golive hide" id="golive"></button>' +
      '<select id="pick" aria-label="Open an activity for answers"><option value="">Open for answers…</option>' + opts + '</select>' +
      '<button class="hide" id="showlive">' + ico('hand') + ' Answers panel</button>' +
      '<a class="res" href="#/results/' + tid + '" id="resbtn">Results →</a></span>' + toolsBtn() + '</div>' +
      '<div class="lockbar fac' + (topicOpen(tid) ? ' hide' : '') + '" id="lockbar">' + ico('lock') + ' This topic is closed to participants.<button id="openit">Open to class</button></div>' +
      '<div class="endbar fac hide" id="endbar"></div>' +
      '<div class="pbody"><iframe id="deck" src="course/' + encodeURIComponent(T.deck) + (slide ? '#/' + slide : '') + '" title="' + esc(T.title) + '" allow="autoplay; fullscreen" allowfullscreen></iframe><aside class="livepanel hide" id="live"></aside></div>' +
      '<div class="pnav"><button id="prev" aria-label="Previous slide">‹ Back</button><span id="pcount" aria-live="polite"></span><button id="next" aria-label="Next slide">Next ›</button></div></div>');
    var sendKey = function (k) { $f.contentWindow.postMessage({ type: 'dpe-key', key: k }, '*'); $f.contentWindow.focus(); };
    document.getElementById('prev').onclick = function () { sendKey('ArrowLeft'); };
    var $nx = document.getElementById('next');
    $nx.onclick = function () { if ($nx.dataset.end) location.hash = '#/'; else sendKey('ArrowRight'); };
    var $f = document.getElementById('deck'), $go = document.getElementById('golive'), $live = document.getElementById('live');
    document.getElementById('openit').onclick = function () { setTopic(tid, true).then(function () { document.getElementById('lockbar').classList.add('hide'); }); };
    document.getElementById('pick').onchange = function () { if (this.value) goLive(this.value); this.value = ''; };
    document.getElementById('showlive').onclick = function () { panelHidden = false; showPanel(); };
    $f.onload = function () { try { $f.contentWindow.focus(); } catch (e) {} };
    // live topic (bar button) and Mark complete (on the last slide)
    var $tl = document.getElementById('tlive'), $end = document.getElementById('endbar');
    function drawMark() {
      var mk = topicMark(tid), nx = nextTopic(tid);
      $tl.classList.toggle('on', mk === 'live'); $tl.disabled = mk === 'live';
      $tl.innerHTML = ico('dot') + (mk === 'live' ? ' Live topic' : ' Start as live topic');
      $end.innerHTML = mk === 'done'
        ? '<span>' + ico('check') + ' ' + tid + ' is complete.</span>' + (nx ? '<button id="nextt">Start ' + nx.id + ': ' + esc(nx.title) + ' ›</button>' : '<span>That was the last topic.</span>')
        : '<span>End of ' + tid + '.</span><button id="markdone">' + ico('check') + ' Mark ' + tid + ' complete</button>';
      var md = document.getElementById('markdone'); if (md) md.onclick = function () { md.disabled = true; markTopic(tid, 'ended').then(drawMark); };
      var nt = document.getElementById('nextt'); if (nt) nt.onclick = function () { nt.disabled = true; markTopic(nx.id, 'live').then(function (ok) { if (ok) location.hash = '#/present/' + nx.id; }); };
    }
    $tl.onclick = function () { $tl.disabled = true; markTopic(tid, 'live').then(function () { document.getElementById('lockbar').classList.toggle('hide', topicOpen(tid)); drawMark(); }); };
    drawMark();

    // follow the deck: which slide is on screen?
    every(400, function () {
      var d; try { d = $f.contentDocument; } catch (e) { return; }
      if (!d) return;
      var sl = d.querySelector('.deck > .slide.is-active'); if (!sl) return;
      var all = d.querySelectorAll('.deck > .slide'), idx = Array.prototype.indexOf.call(all, sl);
      var a = T.activities.find(function (x) { return x.slide === sl.dataset.title; });
      if ((a && a.id) !== current) {
        current = a && a.id;
        $go.classList.toggle('hide', !a);
        if (a) { $go.innerHTML = ico('hand') + (answering(a.id) ? ' Show answers' : ' Open for answers'); $go.title = a.title; $go.setAttribute('aria-label', $go.textContent.trim() + ': ' + a.title); }
        document.getElementById('pick').options[0].textContent = a ? 'Other activity…' : 'Open for answers…';
      }
      $end.classList.toggle('hide', idx !== all.length - 1);
    });
    $go.onclick = function () { if (current) goLive(current); };

    async function goLive(aid) {
      var st = S.acts[aid];
      if (!topicOpen(tid)) { await setTopic(tid, true); document.getElementById('lockbar').classList.add('hide'); }
      if (!st || st.status !== 'live') {
        var a = ACT[aid].a;
        var r = await sb.from('activity_state').upsert({ cohort_id: cid, activity_id: aid, topic_id: tid, status: 'live', opened_at: new Date().toISOString(), duration_min: a.minutes }).select().single();
        if (r.error) { toast(errMsg(r.error)); return; }
        S.acts[aid] = r.data;
      }
      liveId = aid; panelHidden = false; current = null; showPanel();
    }

    function showPanel() {
      if (!liveId) return;
      var a = ACT[liveId].a, url = BASE + '?a=' + liveId + '&join=' + encodeURIComponent(S.cohort.join_code), st = S.acts[liveId];   // the code lets late joiners register
      $live.classList.toggle('hide', panelHidden);
      document.getElementById('showlive').classList.toggle('hide', !panelHidden);
      $live.innerHTML = '<div class="row" style="justify-content:space-between"><span class="tag ans">' + (st.status === 'live' ? ico('hand') + ' Open for answers' : 'Closed') + '</span><span class="row" style="gap:8px"><span class="timer" id="ptimer"></span><button class="pclose" id="hidep" aria-label="Hide the answers panel" title="Hide panel">' + ico('x') + '</button></span></div>' +
        '<h3>' + esc(a.title) + '</h3><div class="qrbig">' + qr(url) + '</div>' +
        '<div class="short">' + esc(SHORT) + '<wbr><span style="white-space:nowrap">' + esc('?a=' + liveId) + '</span></div><button class="btn primary block" id="cpl">Copy link for the chat</button>' +
        '<div class="finbox"><b id="c-fin">…</b> <span>of <span id="c-reg">…</span> finished</span><div class="prog" role="progressbar" aria-label="Finished" id="c-prog"><i id="c-bar"></i></div></div>' +
        '<div class="counts"><div><b id="c-acc">…</b><span>opened it</span></div><div><b id="c-act">…</b><span>working now</span></div></div>' +
        '<div class="row"><button class="btn small" id="restart">Restart timer</button>' + (st.status === 'live' ? '<button class="btn small danger" id="end">Close answers</button>' : '<button class="btn small" id="reopen">Reopen</button>') + '</div>';
      document.getElementById('cpl').onclick = function () { copy(url); };
      document.getElementById('hidep').onclick = function () { panelHidden = true; showPanel(); };
      document.getElementById('restart').onclick = function () { setAct({ status: 'live', opened_at: new Date().toISOString() }); };
      var e = document.getElementById('end'); if (e) armed(e, 'Tap again to close', function () { setAct({ status: 'ended' }); });
      var ro = document.getElementById('reopen'); if (ro) ro.onclick = function () { setAct({ status: 'live' }); };
      counts();
    }
    async function setAct(patch) {
      var r = await sb.from('activity_state').update(patch).eq('cohort_id', cid).eq('activity_id', liveId).select().single();
      if (r.error) { toast(errMsg(r.error)); return; }
      S.acts[liveId] = r.data; showPanel();
    }
    async function counts() {
      if (!liveId) return;
      var r = await sb.rpc('activity_live', { p_activity: liveId, p_cohort: cid });
      if (r.error || !r.data) return;
      var d = r.data, set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
      set('c-acc', d.accessed); set('c-reg', d.registered); set('c-fin', d.finished); set('c-act', d.active);
      var bar = document.getElementById('c-bar'); if (bar) bar.style.width = pct(d.finished, d.registered) + '%';
      var pg = document.getElementById('c-prog'); if (pg) pg.setAttribute('aria-valuenow', pct(d.finished, d.registered));
      var sl = document.getElementById('showlive'); if (sl) sl.innerHTML = ico('hand') + ' Answers ' + d.finished + '/' + d.registered + ' finished';
    }
    every(3000, counts);
    every(1000, function () {
      var $t = document.getElementById('ptimer'); if (!$t || !liveId) return;
      var st = S.acts[liveId], end = new Date(st.opened_at).getTime() + (st.duration_min || 0) * 60000, left = (end - Date.now()) / 1000;
      $t.classList.toggle('over', !!st.duration_min && left <= 0);
      $t.innerHTML = st.duration_min ? (left > 0 ? ico('timer') + ' ' + clock(left) : ico('timer') + ' Time\'s up +' + clock(-left)) : '';
    });
    // reopen the panel if an activity of this topic is already live
    var already = T.activities.find(function (a) { return S.acts[a.id] && S.acts[a.id].status === 'live'; });
    if (already) { liveId = already.id; panelHidden = true; showPanel(); }
  }

  // ---------- results dashboard
  // one activity: who is done and who is still pending (facilitator)
  function vWho(aid) {
    var A = ACT[aid].a, tid = ACT[aid].topic;
    function draw() {
      var m = S.prog[aid] || {}, n = S.parts.length, st = S.acts[aid];
      var ok = function (p) { return m[p.id] && m[p.id].status === 'submitted'; };
      var d = S.parts.filter(ok).length;
      render(topbar() + '<main class="wrap" style="padding:20px 16px 48px">' +
        '<p class="muted small" style="margin:0">' + tid + ' ' + esc(TOPIC[tid].t.title) + '</p>' +
        '<h1 style="margin:4px 0 0;letter-spacing:-.02em">' + esc(A.title) + '</h1>' +
        '<div class="row mt-1"><a class="btn small" href="#/">← Home</a>' + (answering(aid) ? '<span class="tag ans">' + ico('hand') + ' Open for answers</span>' : '') + '</div>' +
        '<div class="finbox mt-3"><b>' + d + '</b> <span>of ' + n + ' done · ' + (n - d) + ' pending</span><div class="prog" role="progressbar" aria-label="Done" aria-valuenow="' + d + '" aria-valuemax="' + n + '"><i style="width:' + (n ? d / n * 100 : 0) + '%"></i></div></div>' +
        '<div class="card mt-3" style="padding:0;overflow:auto"><table class="who"><thead><tr><th>Name</th><th>Position</th><th>Status</th></tr></thead><tbody>' +
        (S.parts.map(function (p) { return '<tr><td><b>' + esc(fullName(p)) + '</b></td><td>' + esc(p.position || '') + '</td><td>' + (ok(p) ? '<span class="tag done">Done</span>' : '<span class="tag sub">Pending</span>') + '</td></tr>'; }).join('') ||
          '<tr><td colspan="3" class="muted">No one has registered yet.</td></tr>') + '</tbody></table></div></main>');
    }
    draw();
    every(5000, async function () { if (document.hidden) return; var was = JSON.stringify([S.prog[aid], S.acts[aid], S.parts.length]); await loadState(); if (JSON.stringify([S.prog[aid], S.acts[aid], S.parts.length]) !== was) { var y = scrollY; draw(); scrollTo(0, y); } });
  }

  async function vResults(tid) {
    var T = TOPIC[tid].t, M = TOPIC[tid].m, cid = S.profile.cohort_id;
    render(topbar() + '<div class="boot">Loading results…</div>');
    var r = await Promise.all([
      spec(tid),
      sb.from('activity_keys').select('activity_id,key').eq('topic_id', tid),
      sb.from('attempts').select('*').eq('cohort_id', cid).eq('topic_id', tid),
      sb.from('profiles').select('id,first_name,last_name,email,position,role').eq('cohort_id', cid)
    ]);
    var sp = r[0], keys = {}, people = {}, parts = [];
    (r[1].data || []).forEach(function (k) { keys[k.activity_id] = k.key; });
    (r[3].data || []).forEach(function (p) { people[p.id] = p; if (p.role === 'participant') parts.push(p); });
    var atts = (r[2].data || []).filter(function (a) { return people[a.user_id] && people[a.user_id].role === 'participant'; });
    var nreg = parts.length;
    // names stay hidden unless the facilitator asks: this page is often on the shared Zoom screen
    var names = sessionStorage.getItem('dpeNames') === 'on';
    var head = topbar() + '<main class="wrap ' + (names ? 'names-on' : 'names-off') + '" id="resmain" style="padding:20px 16px 0"><p class="muted small" style="margin:0">' + esc(M.n + ' · ' + M.title) + '</p>' +
      '<h1 style="margin:4px 0 0;letter-spacing:-.02em">' + tid + ' ' + esc(T.title) + ': results</h1>' +
      '<div class="row mt-1"><a class="btn small" href="#/present/' + tid + '">← Back to slides</a><button class="btn small" id="refresh">Refresh</button>' +
      '<button class="btn small" id="names" aria-pressed="' + names + '">' + (names ? 'Hide names' : ico('eye') + ' Show names') + '</button><span class="small muted">' + nreg + ' registered</span></div>';
    var html = '', uploads = [], anon = {}, nAnon = 0;
    function who(p) { if (!anon[p.id]) anon[p.id] = ++nAnon; return '<span class="nm">' + esc(fullName(p)) + '</span><span class="anon">Participant ' + anon[p.id] + '</span>'; }
    sp.activities.forEach(function (a) {
      var mine = atts.filter(function (x) { return x.activity_id === a.id; });
      var sub = mine.filter(function (x) { return x.status === 'submitted'; });
      var scored = sub.filter(function (x) { return x.max_score; });
      var avg = scored.length ? scored.reduce(function (s, x) { return s + x.score / x.max_score; }, 0) / scored.length : null;
      var k = keys[a.id] || {};
      html += '<section class="card res-act"><div class="hd"><div><span class="tag">' + a.id + '</span> <h3 style="display:inline">' + esc(a.title) + '</h3></div>' +
        '<div class="kpis"><div><b>' + sub.length + '<small class="muted">/' + nreg + '</small></b><span>finished</span></div><div><b>' + mine.length + '</b><span>opened</span></div>' +
        (avg != null ? '<div><b>' + Math.round(avg * 100) + '%</b><span>average score</span></div>' : '') + '</div></div>';
      a.blocks.forEach(function (b) {
        var vals = sub.map(function (x) { return { v: x.answers[b.id], p: people[x.user_id], at: x }; }).filter(function (x) { return x.v != null && x.v !== ''; });
        var kk = k[b.id];
        if (b.type === 'mcq') {
          var ns = b.options.map(function (o, i) { return vals.filter(function (x) { return x.v.indexOf(i) >= 0; }).length; });
          var isRight = function (i) { return kk && kk.mcq.indexOf(i) >= 0; };
          var topWrong = -1; ns.forEach(function (n, i) { if (!isRight(i) && n && (topWrong < 0 || n > ns[topWrong])) topWrong = i; });
          html += '<div class="mt-2"><p class="p" style="font-weight:700;margin:0">' + esc(b.prompt) + '</p>' + b.options.map(function (o, i) {
            var n = ns[i], right = isRight(i);
            return '<div class="bar' + (right ? ' right' : i === topWrong ? ' topwrong' : '') + '"><span class="lbl">' + LETTERS[i] + '. ' + esc(o) + (right ? ' ' + ico('check') : '') + '</span><span class="tr"><i style="width:' + pct(n, vals.length) + '%"></i></span><b>' + n + ' <small>' + pct(n, vals.length) + '%</small></b></div>';
          }).join('') + '</div>';
        } else if (b.type === 'number' || b.type === 'short' || b.type === 'sort') {
          var ok = sub.filter(function (x) { var f = x.feedback && x.feedback[b.id]; return f && f.points >= 1; }).length;
          var wrong = {};
          if (b.type !== 'sort') vals.forEach(function (x) { var f = x.at.feedback && x.at.feedback[b.id]; if (!(f && f.points >= 1)) { var s = String(x.v).trim(); wrong[s] = (wrong[s] || 0) + 1; } });
          var top = Object.keys(wrong).sort(function (p, q) { return wrong[q] - wrong[p]; }).slice(0, 4);
          var ans = kk ? (kk.number != null ? (kk.tol ? (kk.number - kk.tol) + ' to ' + (kk.number + kk.tol) : Number(kk.number).toLocaleString('en-PH')) : kk.short ? kk.short[0] : '') : '';
          html += '<div class="mt-2"><p style="font-weight:700;margin:0">' + esc(b.prompt) + '</p><div class="bar right"><span class="lbl">' + (ans ? 'Answer ' + esc(ans) : 'All correct') + '</span><span class="tr"><i style="width:' + pct(ok, sub.length) + '%"></i></span><b>' + pct(ok, sub.length) + '%</b></div>' +
            (top.length ? '<div class="small muted">Common wrong answers: ' + top.map(function (s) { return '<b>' + esc(s) + '</b> (' + wrong[s] + ')'; }).join(', ') + '</div>' : '') + '</div>';
          if (b.type === 'sort' && kk) html += '<div class="small">' + b.items.map(function (it) {
            var n = vals.filter(function (x) { return x.v[it] === kk.sort[it]; }).length;
            return '<div class="bar' + (pct(n, vals.length) >= 75 ? ' right' : '') + '"><span>' + esc(it) + ' → ' + esc(b.bins[kk.sort[it]]) + '</span><span class="tr"><i style="width:' + pct(n, vals.length) + '%"></i></span><b>' + pct(n, vals.length) + '%</b></div>';
          }).join('') + '</div>';
        } else if (b.type === 'steps') {
          var all = sub.filter(function (x) { return (x.answers[b.id] || []).length === b.items.length; }).length;
          html += '<p class="small mt-2"><b>Steps:</b> ' + all + ' of ' + sub.length + ' ticked every step.</p>';
        } else if (b.type === 'text') {
          html += '<div class="mt-2"><p style="font-weight:700;margin:0 0 6px">' + esc(b.prompt) + ' <span class="muted small">(' + vals.length + ')</span></p><div class="answers">' +
            (vals.map(function (x) { return '<div><b>' + who(x.p) + ':</b> ' + esc(x.v) + '</div>'; }).join('') || '<div class="muted">No answers yet.</div>') + '</div></div>';
        } else if (b.type === 'upload') {
          var gid = 'g-' + a.id.replace('.', '-') + '-' + b.id;
          html += '<div class="mt-2"><p style="font-weight:700;margin:0 0 6px">' + esc(b.prompt) + ' <span class="muted small">(' + vals.length + ')</span></p><div class="gallery" id="' + gid + '">' +
            (vals.length ? '' : '<span class="muted small">No files yet.</span>') + '</div></div>';
          vals.forEach(function (x) { uploads.push({ gid: gid, path: x.v.path, name: x.v.name, type: x.v.type, who: who(x.p) }); });
        } else if (b.type === 'rubric') {
          html += rubricTable(a, b, sub, people, who);
        }
      });
      var notyet = parts.filter(function (p) { return !sub.some(function (x) { return x.user_id === p.id; }); });
      if (notyet.length && sub.length) html += '<details class="mt-2"><summary class="small">Not submitted yet (' + notyet.length + ')</summary><p class="small nm">' + notyet.map(fullName).map(esc).join(', ') + '</p>' +
        '<p class="small muted anon">Names are hidden. Use Show names when you aren\'t sharing your screen.</p></details>';
      html += '</section>';
    });
    // topic summary: who finished every activity, and the average score
    var allDone = parts.filter(function (p) { return sp.activities.every(function (a) { return atts.some(function (x) { return x.user_id === p.id && x.activity_id === a.id && x.status === 'submitted'; }); }); }).length;
    var scoredAll = atts.filter(function (x) { return x.status === 'submitted' && x.max_score; });
    var avgAll = scoredAll.length ? Math.round(100 * scoredAll.reduce(function (s, x) { return s + x.score / x.max_score; }, 0) / scoredAll.length) + '%' : '–';
    var mt = M.topics, i = mt.findIndex(function (t) { return t.id === tid; }), nx = mt[i + 1];
    var nextBtn = nx ? '<a class="btn primary" href="#/present/' + nx.id + '">Next: ' + nx.id + ' ' + esc(nx.title) + ' →</a>' : '<a class="btn primary" href="#/">End of ' + esc(M.n) + ' · Home</a>';
    var summary = '<section class="card summary"><div class="kpis"><div><b>' + allDone + '<small class="muted">/' + nreg + '</small></b><span>finished every activity</span></div>' +
      '<div><b>' + avgAll + '</b><span>average score</span></div><div><b>' + sp.activities.length + '</b><span>activities</span></div></div>' + nextBtn + '</section>';
    html = head + summary + html + '<div class="next">' + (nx ? '<a class="btn" href="#/">Home</a>' : '') + nextBtn + '</div></main>';
    render(html);
    document.getElementById('refresh').onclick = function () { vResults(tid); };
    document.getElementById('names').onclick = function () {
      var on = !document.getElementById('resmain').classList.contains('names-on');
      try { sessionStorage.setItem('dpeNames', on ? 'on' : 'off'); } catch (e) {}
      document.getElementById('resmain').className = 'wrap ' + (on ? 'names-on' : 'names-off');
      this.innerHTML = on ? 'Hide names' : ico('eye') + ' Show names'; this.setAttribute('aria-pressed', on);
    };
    bindRubrics(tid);
    if (uploads.length) {
      var su = await sb.storage.from('outputs').createSignedUrls(uploads.map(function (u) { return u.path; }), 3600);
      (su.data || []).forEach(function (s, k) {
        var u = uploads[k], g = document.getElementById(u.gid); if (!g || !s.signedUrl) return;
        g.insertAdjacentHTML('beforeend', '<a href="' + esc(s.signedUrl) + '" target="_blank" rel="noopener">' +
          (/^image\//.test(u.type) ? '<img src="' + esc(s.signedUrl) + '" alt="">' : '<span style="font-size:28px;padding:20px 8px 0">' + ico('file-text') + '</span>') +
          '<span><b>' + u.who + '</b><span class="nm"><br>' + esc(u.name) + '</span></span></a>');
      });
    }
  }

  function rubricTable(a, b, sub, people, who) {
    var tot = b.criteria.reduce(function (s, c) { return s + c.points; }, 0);
    return '<div class="mt-2 scroll-x"><p style="font-weight:700;margin:0 0 6px">Score the lab (rubric, ' + tot + ' pts)</p><table class="people"><tr><th>Participant</th>' +
      b.criteria.map(function (c) { return '<th title="' + esc(c.name) + '">' + esc(c.name.length > 22 ? c.name.slice(0, 20) + '…' : c.name) + '<br><span class="muted">/' + c.points + '</span></th>'; }).join('') + '<th>Total</th><th></th></tr>' +
      (sub.map(function (x) {
        var rb = x.rubric || {};
        return '<tr data-att="' + x.id + '" data-act="' + a.id + '"><td>' + who(people[x.user_id]) + '</td>' + b.criteria.map(function (c, k) {
          return '<td><input class="in" style="width:64px;min-height:36px;padding:6px" type="number" min="0" max="' + c.points + '" step="0.5" data-k="' + k + '" value="' + (rb[k] == null ? '' : rb[k]) + '"></td>';
        }).join('') + '<td class="rt"><b>' + Object.values(rb).reduce(function (s, v) { return s + (+v || 0); }, 0) + '</b>/' + tot + '</td><td><button class="btn small" data-save>Save</button></td></tr>';
      }).join('') || '<tr><td colspan="99" class="muted">No submissions yet.</td></tr>') + '</table></div>';
  }
  function bindRubrics() {
    document.querySelectorAll('tr[data-att] [data-save]').forEach(function (btn) {
      btn.onclick = async function () {
        var tr = btn.closest('tr'), rb = {};
        tr.querySelectorAll('input[data-k]').forEach(function (i) { if (i.value !== '') rb[i.dataset.k] = Math.min(+i.max, Math.max(0, +i.value)); });
        var r = await sb.from('attempts').update({ rubric: rb }).eq('id', tr.dataset.att);
        if (r.error) { toast(errMsg(r.error)); return; }
        tr.querySelector('.rt b').textContent = Object.values(rb).reduce(function (s, v) { return s + v; }, 0); toast('Saved');
      };
    });
  }

  // ---------- people
  async function vPeople() {
    var cid = S.profile.cohort_id;
    var r = await Promise.all([
      sb.from('profiles').select('*').eq('cohort_id', cid).eq('role', 'participant').order('last_name'),
      sb.from('attempts').select('user_id,activity_id,status,score,max_score,rubric').eq('cohort_id', cid)
    ]);
    var ps = r[0].data || [], at = r[1].data || [];
    var done = {}; at.forEach(function (x) { if (x.status === 'submitted') done[x.user_id] = (done[x.user_id] || 0) + 1; });
    render(topbar() + '<main class="wrap page"><a class="btn small" href="#/">← Home</a><div class="row mt-2" style="justify-content:space-between"><h1 style="margin:0">People (' + ps.length + ')</h1>' +
      '<div class="row"><button class="btn" id="csv1">Download participants (CSV)</button><button class="btn" id="csv2">Download scores (CSV)</button></div></div>' +
      '<div class="scroll-x mt-2"><table class="people"><tr><th>Name (certificate)</th><th>Email</th><th>Organization</th><th>Position</th><th>Registered</th><th>Submitted</th></tr>' +
      ps.map(function (p) { return '<tr><td><b>' + esc(fullName(p)) + '</b></td><td>' + esc(p.email) + '</td><td>' + esc(p.organization) + '</td><td>' + esc(p.position) + '</td><td>' + when(p.created_at) + '</td><td>' + (done[p.id] || 0) + '</td></tr>'; }).join('') +
      '</table></div></main>');
    function dl(name, rows) {
      var csv = rows.map(function (r) { return r.map(function (c) { c = String(c == null ? '' : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\n');
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = name; a.click();
    }
    var day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    document.getElementById('csv1').onclick = function () {
      dl('Participants - ' + S.cohort.name + ' - ' + day + '.csv', [['First name', 'Last name', 'Certificate name', 'Email', 'Organization', 'Position', 'Registered', 'Privacy agreed']].concat(
        ps.map(function (p) { return [p.first_name, p.last_name, fullName(p), p.email, p.organization, p.position, when(p.created_at), when(p.privacy_agreed_at)]; })));
    };
    document.getElementById('csv2').onclick = function () {
      var ids = Object.keys(ACT);
      dl('Scores - ' + S.cohort.name + ' - ' + day + '.csv', [['Name'].concat(ids)].concat(ps.map(function (p) {
        return [fullName(p)].concat(ids.map(function (id) {
          var x = at.find(function (y) { return y.user_id === p.id && y.activity_id === id; });
          if (!x || x.status !== 'submitted') return '';
          if (x.rubric && Object.keys(x.rubric).length) return Object.values(x.rubric).reduce(function (s, v) { return s + v; }, 0);
          return x.max_score ? Math.round(x.score * 100) / 100 + '/' + x.max_score : 'done';
        }));
      })));
    };
  }

  // ---------- start
  (async function start() {
    var q = new URLSearchParams(location.search);
    if (q.get('join')) sessionStorage.setItem('dpeJoin', q.get('join'));
    if (q.get('a') && ACT[q.get('a')]) sessionStorage.setItem('dpeGo', '#/a/' + q.get('a'));
    if (location.search) history.replaceState(null, '', location.pathname + location.hash);
    sb.auth.onAuthStateChange(function (ev, session) {
      S.session = session;
      if (ev === 'PASSWORD_RECOVERY') { location.hash = '#/reset'; route(); }
      if (ev === 'SIGNED_OUT') { S.profile = null; }
    });
    var s = await sb.auth.getSession(); S.session = s.data.session;
    window.addEventListener('hashchange', route);
    // remember where you are on the home list (this tab only), so coming back from a lesson lands there
    history.scrollRestoration = 'manual';
    var onHome = function () { return (location.hash === '' || location.hash === '#/') && !!document.querySelector('.modsec'); };
    window.addEventListener('scroll', function () { if (onHome()) { clearTimeout(onHome.t); onHome.t = setTimeout(function () { if (onHome()) sessionStorage.setItem('dpeHomeY', scrollY); }, 150); } }, { passive: true });
    route();
  })();
})();
