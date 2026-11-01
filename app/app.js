/* DPE LMS · participant + facilitator app (plain JS, hash routes)
   #/                home (participants: topics; admin: registration QR + topic controls)
   #/register #/login #/forgot #/reset
   #/topic/2.4       topic page (slides, video, activities)
   #/deck/2.4        slides viewer        #/video/2.4   video viewer
   #/a/2.4-a         activity page (participants open it from the QR / short link ?a=2.4-a)
   #/present/2.4     admin: deck + Go live panel (QR, short link, live counts)
   #/results/2.4     admin: topic results, then Next topic / Home
   #/people          admin: participant list + CSV */
(function () {
  'use strict';
  var C = window.DPE_CONFIG, CAT = window.CATALOG;
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
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2200);
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
  function when(ts) { return ts ? new Date(ts).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : ''; }
  function clock(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
  function num(v) {
    if (v == null || v === '') return null;
    var s = String(v).replace(/[₱,\s]/g, '').replace(/^php/i, '');
    var n = Number(s); return isFinite(n) && s !== '' ? n : String(v);
  }
  function pct(a, b) { return b ? Math.round(100 * a / b) : 0; }
  function fullName(p) { return (p.first_name + ' ' + p.last_name).trim(); }
  function errMsg(e) { return (e && (e.message || e.error_description)) || String(e); }
  function isAdmin() { return S.profile && S.profile.role === 'admin'; }
  function logos() {
    return '<div class="logos"><img src="course/images/logos/dict.png" alt="DICT"><img src="course/images/logos/bir.png" alt="Bureau of Internal Revenue"><img class="sd" src="course/images/logos/serial-disruptors.png" alt="Serial Disruptors"></div>';
  }
  function topbar() {
    var p = S.profile;
    return '<header class="top"><div class="wrap"><a class="brand" href="#/"><span>DPE</span> · Digital Productivity Essentials</a>' +
      (p ? '<span class="who">' + esc(p.first_name) + (isAdmin() ? ' · admin' : '') + '</span>' +
        (isAdmin() ? '<a class="btn-top" href="#/people">People</a>' : '') +
        '<button id="signout">Sign out</button>' : '<a class="btn-top" href="#/login">Sign in</a>') +
      '</div></header>';
  }
  function bindTop() {
    var so = document.getElementById('signout');
    if (so) so.onclick = function () { sb.auth.signOut().then(function () { S.profile = null; S.session = null; location.hash = '#/'; route(); }); };
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
      sb.from('attempts').select('activity_id,status,score,max_score').eq('user_id', S.profile.id)
    ]);
    S.topics = {}; (r[0].data || []).forEach(function (x) { S.topics[x.topic_id] = x; });
    S.acts = {}; (r[1].data || []).forEach(function (x) { S.acts[x.activity_id] = x; });
    S.mine = {}; (r[2].data || []).forEach(function (x) { S.mine[x.activity_id] = x; });
  }
  function topicOpen(tid) { return S.topics[tid] && S.topics[tid].status === 'open'; }

  // ---------- router
  async function route() {
    clearTimers(); $modal.innerHTML = '';
    var hash = location.hash.replace(/^#\/?/, '');
    if (/^(access_token|error|type=)/.test(hash)) return;   // Supabase is reading a link token
    var parts = hash.split('/'), view = parts[0], arg = decodeURIComponent(parts.slice(1).join('/'));
    if (view === 'reset') return vReset();
    if (!S.session) {
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
    if ((view === 'deck' || view === 'video') && TOPIC[arg]) return vViewer(view, arg);
    if (isAdmin()) {
      if (view === 'present' && TOPIC[arg]) return vPresent(arg);
      if (view === 'results' && TOPIC[arg]) return vResults(arg);
      if (view === 'people') return vPeople();
    }
    return isAdmin() ? vAdminHome() : vHome();
  }

  // ---------- landing, privacy, registration, sign in
  async function vLanding() {
    var code = sessionStorage.getItem('dpeJoin') || '';
    var cname = code ? (await sb.rpc('check_join_code', { p_code: code })).data : null;
    render(topbar() +
      '<section class="hero"><div class="wrap"><p class="kicker">DICT · ILCDB training</p>' +
      '<h1>Digital Productivity <span>Essentials</span></h1>' +
      '<p>Welcome! This is your course home for the next two days: slides, videos and the activities you\'ll do with us live.</p>' +
      logos() + '</div></section>' +
      '<main class="narrow" style="margin-top:-18px;padding-bottom:40px"><div class="card stack">' +
      (cname ? '<h2>Join ' + esc(cname) + '</h2><p class="muted">Class code <b>' + esc(code.toUpperCase()) + '</b>. It takes about a minute.</p>' +
        '<button class="btn primary block" id="start">Get started</button>'
        : '<h2>Join the class</h2><p class="muted">Scan the QR code on the facilitator\'s screen, or type the class code.</p>' +
        '<div class="field"><label class="f" for="code">Class code</label><input id="code" autocomplete="off" autocapitalize="characters" value="' + esc(code) + '"></div>' +
        '<div class="err" id="err"></div><button class="btn primary block" id="start">Continue</button>') +
      '<p class="small muted" style="text-align:center">Already registered? <a href="#/login">Sign in</a></p></div></main>');
    document.getElementById('start').onclick = async function () {
      var inp = document.getElementById('code');
      if (inp) {
        var c = inp.value.trim();
        var r = await sb.rpc('check_join_code', { p_code: c });
        if (!r.data) { document.getElementById('err').textContent = 'That code doesn\'t match a class. Check the facilitator\'s screen.'; return; }
        sessionStorage.setItem('dpeJoin', c);
      }
      privacy(function () { sessionStorage.setItem('dpePrivacy', C.privacyVersion); location.hash = '#/register'; });
    };
  }

  function privacy(onAgree) {
    $modal.innerHTML = '<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="pv-t">' +
      '<h2 id="pv-t">Data privacy agreement</h2>' +
      '<p>To take part in this course, we will collect your <b>name, email, organization and position</b>, and the <b>answers and files</b> you submit in the activities.</p>' +
      '<ul><li>Your data and personal details will be <b>kept private</b>. They are used only to run this course and to prepare your certificate.</li>' +
      '<li>Your data will be <b>stored for at least 1 year</b> from the day you register.</li>' +
      '<li>We handle it in line with the Data Privacy Act of 2012 (RA 10173).</li></ul>' +
      '<div class="row" style="justify-content:flex-end;margin-top:18px"><button class="btn" id="pv-no">Not now</button><button class="btn primary" id="pv-yes">I agree</button></div>' +
      '</div></div>';
    document.getElementById('pv-no').onclick = function () { $modal.innerHTML = ''; };
    document.getElementById('pv-yes').onclick = function () { $modal.innerHTML = ''; onAgree(); };
  }

  function pwField(id, label, hint) {
    return '<div class="field"><label class="f" for="' + id + '">' + label + '</label><div class="pw"><input id="' + id + '" type="password" autocomplete="' +
      (id === 'pw' || id === 'np' ? 'new-password' : 'current-password') + '"><button type="button" data-show="' + id + '">Show</button></div>' +
      (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>';
  }
  function bindShow() {
    document.querySelectorAll('[data-show]').forEach(function (b) {
      b.onclick = function () { var i = document.getElementById(b.dataset.show); i.type = i.type === 'password' ? 'text' : 'password'; b.textContent = i.type === 'password' ? 'Show' : 'Hide'; };
    });
  }

  function vRegister() {
    var code = sessionStorage.getItem('dpeJoin');
    if (!code) { location.hash = '#/'; return; }
    if (sessionStorage.getItem('dpePrivacy') !== C.privacyVersion) { privacy(function () { sessionStorage.setItem('dpePrivacy', C.privacyVersion); vRegister(); }); return vLanding(); }
    render(topbar() + '<main class="narrow" style="padding:24px 16px 48px"><div class="card">' +
      '<h2>Register</h2><p class="muted small">Class code ' + esc(code.toUpperCase()) + '</p>' +
      '<div class="note blue">Type your name <b>exactly as it should appear on your certificate</b>.</div>' +
      '<div class="cols2"><div class="field"><label class="f" for="fn">First name</label><input id="fn" autocomplete="given-name"></div>' +
      '<div class="field"><label class="f" for="ln">Last name</label><input id="ln" autocomplete="family-name"></div></div>' +
      '<div class="hint" id="cert">Certificate name: <b>…</b></div>' +
      '<div class="field"><label class="f" for="em">Email</label><input id="em" type="email" autocomplete="email" inputmode="email"><div class="hint">Used to recover your password, so use one you can open.</div></div>' +
      '<div class="field"><label class="f" for="em2">Type your email again</label><input id="em2" type="email" autocomplete="off" inputmode="email"></div>' +
      '<div class="field"><label class="f" for="org">Organization</label><input id="org" value="' + esc(C.defaultOrganization) + '"></div>' +
      '<div class="field"><label class="f" for="pos">Position</label><input id="pos" autocomplete="organization-title"></div>' +
      pwField('pw', 'Create a password', 'At least 8 characters.') +
      '<div class="err" id="err"></div>' +
      '<button class="btn primary block" id="go" style="margin-top:18px">Create my account</button>' +
      '<p class="small muted" style="text-align:center">Already registered? <a href="#/login">Sign in</a></p></div></main>');
    bindShow();
    var $ = function (id) { return document.getElementById(id); };
    function cert() { $('cert').innerHTML = 'Certificate name: <b>' + (esc(($('fn').value + ' ' + $('ln').value).trim()) || '…') + '</b>'; }
    $('fn').oninput = cert; $('ln').oninput = cert;
    $('go').onclick = async function () {
      var v = { fn: $('fn').value.trim(), ln: $('ln').value.trim(), em: $('em').value.trim().toLowerCase(), em2: $('em2').value.trim().toLowerCase(),
        org: $('org').value.trim(), pos: $('pos').value.trim(), pw: $('pw').value };
      var e = !v.fn || !v.ln ? 'Please type your first and last name.' :
        !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.em) ? 'Please type a valid email.' :
        v.em !== v.em2 ? 'The two emails don\'t match.' :
        !v.org ? 'Please type your organization.' : !v.pos ? 'Please type your position.' :
        v.pw.length < 8 ? 'Your password needs at least 8 characters.' : '';
      $('err').textContent = e; if (e) return;
      this.disabled = true; this.textContent = 'Creating your account…';
      var r = await sb.auth.signUp({ email: v.em, password: v.pw, options: { emailRedirectTo: BASE, data: {
        first_name: v.fn, last_name: v.ln, organization: v.org, position: v.pos, join_code: code, privacy_version: C.privacyVersion } } });
      if (r.error) {
        this.disabled = false; this.textContent = 'Create my account';
        $('err').textContent = /already registered/i.test(r.error.message) ? 'This email already has an account. Sign in instead.' :
          /database error/i.test(r.error.message) ? 'We couldn\'t register you with this class code. Check the code and try again.' : errMsg(r.error);
        return;
      }
      if (!r.data.session) { render(topbar() + '<main class="narrow" style="padding:32px 16px"><div class="card"><h2>Check your email</h2><p>Open the link we sent to <b>' + esc(v.em) + '</b>, then sign in.</p></div></main>'); return; }
      S.session = r.data.session; sessionStorage.removeItem('dpeJoin');
      toast('Welcome, ' + v.fn + '!'); location.hash = sessionStorage.getItem('dpeGo') || '#/'; route();
    };
  }

  function vLogin() {
    render(topbar() + '<main class="narrow" style="padding:24px 16px 48px"><div class="card"><h2>Sign in</h2>' +
      '<div class="field"><label class="f" for="em">Email</label><input id="em" type="email" autocomplete="email" inputmode="email"></div>' +
      pwField('pwl', 'Password') + '<div class="err" id="err"></div>' +
      '<button class="btn primary block" id="go" style="margin-top:18px">Sign in</button>' +
      '<p class="small" style="text-align:center"><a href="#/forgot">Forgot your password?</a> · <a href="#/">New here? Join the class</a></p></div></main>');
    bindShow();
    document.getElementById('go').onclick = async function () {
      var r = await sb.auth.signInWithPassword({ email: document.getElementById('em').value.trim(), password: document.getElementById('pwl').value });
      if (r.error) { document.getElementById('err').textContent = /invalid/i.test(r.error.message) ? 'Wrong email or password.' : errMsg(r.error); return; }
      S.session = r.data.session; location.hash = sessionStorage.getItem('dpeGo') || '#/'; route();
    };
  }

  function vForgot() {
    render(topbar() + '<main class="narrow" style="padding:24px 16px 48px"><div class="card"><h2>Reset your password</h2>' +
      '<p class="muted">We\'ll email you a link to set a new password.</p>' +
      '<div class="field"><label class="f" for="em">Email</label><input id="em" type="email" inputmode="email"></div><div class="err" id="err"></div>' +
      '<button class="btn primary block" id="go" style="margin-top:18px">Send the link</button><p class="small" style="text-align:center"><a href="#/login">Back to sign in</a></p></div></main>');
    document.getElementById('go').onclick = async function () {
      var r = await sb.auth.resetPasswordForEmail(document.getElementById('em').value.trim(), { redirectTo: BASE });
      if (r.error) { document.getElementById('err').textContent = errMsg(r.error); return; }
      this.disabled = true; this.textContent = 'Sent. Check your email (and spam folder).';
    };
  }

  function vReset() {
    render(topbar() + '<main class="narrow" style="padding:24px 16px 48px"><div class="card"><h2>Set a new password</h2>' +
      pwField('np', 'New password', 'At least 8 characters.') + '<div class="err" id="err"></div>' +
      '<button class="btn primary block" id="go" style="margin-top:18px">Save password</button></div></main>');
    bindShow();
    document.getElementById('go').onclick = async function () {
      var p = document.getElementById('np').value;
      if (p.length < 8) { document.getElementById('err').textContent = 'At least 8 characters, please.'; return; }
      var r = await sb.auth.updateUser({ password: p });
      if (r.error) { document.getElementById('err').textContent = errMsg(r.error) + ' Open the link from your email again.'; return; }
      toast('Password saved'); location.hash = '#/'; route();
    };
  }

  function vNoProfile() {
    render(topbar() + '<main class="narrow" style="padding:32px 16px"><div class="card"><h2>Almost there</h2><p>Your account has no class yet. Scan the class QR code again, or ask the facilitator.</p></div></main>');
  }

  // ---------- participant home
  function actLink(a) {
    var mine = S.mine[a.id], st = S.acts[a.id];
    var tag = mine && mine.status === 'submitted'
      ? '<span class="tag done">✓ ' + (mine.max_score ? Math.round(mine.score * 10) / 10 + '/' + mine.max_score : 'Done') + '</span>'
      : st && st.status === 'live' ? '<span class="tag live">● Live</span>' : '';
    return '<a href="#/a/' + a.id + '"><span>' + esc(a.title) + '</span>' + tag + '</a>';
  }
  function vHome() {
    var p = S.profile;
    var html = topbar() + '<section class="hero"><div class="wrap"><p class="kicker">' + esc(S.cohort ? S.cohort.name : '') + '</p>' +
      '<h1>Hi, <span>' + esc(p.first_name) + '</span></h1><p>Topics open here as we reach them in class. Your answers save as you go.</p></div></section><main class="wrap" style="padding-bottom:48px">';
    var live = Object.keys(S.acts).filter(function (k) { return S.acts[k].status === 'live' && ACT[k] && !(S.mine[k] && S.mine[k].status === 'submitted'); });
    if (live.length) html += '<div class="card" style="margin-top:18px;border-color:var(--bad)"><h3>● Live now</h3>' +
      live.map(function (k) { return '<a class="btn primary" style="margin-top:8px" href="#/a/' + k + '">' + esc(ACT[k].a.title) + ' →</a>'; }).join(' ') + '</div>';
    CAT.forEach(function (m, mi) {
      html += '<section class="module" style="--c:var(--m' + (mi + 1) + ')"><span class="k">' + esc(m.n + ' · ' + m.day) + '</span><h3>' + esc(m.title) + '</h3><div class="topics">';
      m.topics.forEach(function (t) {
        var open = topicOpen(t.id);
        html += '<div class="topic' + (open ? '' : ' locked') + '"><div class="t"><span class="num">' + t.id + '</span><h4>' + esc(t.title) + '</h4></div>' +
          (open ? '<div class="row"><a class="btn small" href="#/deck/' + t.id + '">Slides</a>' + (t.video ? '<a class="btn small" href="#/video/' + t.id + '">▶ Video ' + t.video + '</a>' : '') + '</div>' +
            '<div class="acts">' + t.activities.map(actLink).join('') + '</div>'
            : '<span class="small muted">🔒 Opens when your facilitator starts it</span>') + '</div>';
      });
      html += '</div></section>';
    });
    render(html + '<p class="small muted" style="margin-top:32px">Signed in as ' + esc(p.email) + ' · Certificate name: <b>' + esc(fullName(p)) + '</b></p></main>');
    every(15000, async function () { await loadState(); if (location.hash === '' || location.hash === '#/') { var y = scrollY; vHome(); scrollTo(0, y); } });
  }

  function vTopic(tid) { location.hash = '#/deck/' + tid; }

  // slides / video viewer (participants and admin)
  function vViewer(kind, tid) {
    var T = TOPIC[tid].t;
    if (!isAdmin() && !topicOpen(tid)) { location.hash = '#/'; return; }
    var src = kind === 'deck' ? 'course/' + encodeURIComponent(T.deck) : 'course/videos/' + tid + '/index.html';
    render('<div class="present"><div class="pbar"><a href="#/">⌂ Home</a><span class="t">' + tid + ' ' + esc(T.title) + '</span>' +
      (kind === 'deck' && T.video ? '<a href="#/video/' + tid + '">▶ Video</a>' : kind === 'video' ? '<a href="#/deck/' + tid + '">Slides</a>' : '') +
      '</div><div class="pbody"><iframe src="' + src + '" title="' + esc(T.title) + '" allow="autoplay; fullscreen" allowfullscreen></iframe></div></div>');
  }
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'dpe-home') location.hash = '#/';
  });

  // ---------- activity page (participants)
  async function vActivity(aid) {
    var tid = ACT[aid].topic, T = TOPIC[tid].t;
    render(topbar() + '<div class="boot">Opening the activity…</div>');
    var sp = (await spec(tid)).activities.find(function (x) { return x.id === aid; });
    var r = await sb.rpc('touch_attempt', { p_activity: aid, p_topic: tid, p_answers: null });
    if (r.error) {
      render(topbar() + '<main class="narrow" style="padding:32px 16px"><div class="card stack"><p class="kicker muted small">' + tid + ' · ' + esc(T.title) + '</p><h2>' + esc(sp.title) + '</h2>' +
        '<p>⏳ Waiting for your facilitator to open this activity. This page will open it by itself.</p><a class="btn" href="#/">Back to home</a></div></main>');
      every(5000, async function () { var t = await sb.rpc('touch_attempt', { p_activity: aid, p_topic: tid, p_answers: null }); if (!t.error) route(); });
      return;
    }
    var at = r.data, done = at.status === 'submitted';
    var key = 'dpe-a-' + S.profile.id + '-' + aid;
    var A = at.answers || {};
    if (!done) { try { var loc = JSON.parse(localStorage.getItem(key) || 'null'); if (loc && Object.keys(loc).length > Object.keys(A).length) A = loc; } catch (e) {} }
    var fb = at.feedback || {};
    var kindLbl = { task: 'Hands-on', check: 'Quick check', quiz: 'Quiz', lab: 'Lab' }[sp.kind];
    var html = topbar() + '<div class="act-head"><div class="narrow"><div class="kicker">' + tid + ' · ' + esc(kindLbl) + '</div><h1>' + esc(sp.title) + '</h1>' +
      '<div class="timer hide" id="timer"></div></div></div><main class="narrow" style="padding-bottom:24px">';
    if (done) html += '<div class="card scorebox" style="margin-top:16px"><div class="muted small">Submitted ' + when(at.submitted_at) + '</div>' +
      (at.max_score ? '<div class="big">' + (Math.round(at.score * 10) / 10) + ' / ' + at.max_score + '</div><div class="muted">Your score. Check the answers below.</div>' : '<div class="big">✓</div><div class="muted">Thank you! Your work is in.</div>') + '</div>';
    if (sp.intro) html += '<p style="margin-top:16px">' + esc(sp.intro) + '</p>';
    sp.blocks.forEach(function (b, i) { html += '<div class="block" data-b="' + esc(b.id) + '">' + blockHtml(b, A[b.id], fb[b.id], done, i) + '</div>'; });
    if (sp.help && sp.help.length) html += '<details class="help"><summary>Stuck? Quick fixes</summary><ul>' + sp.help.map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('') + '</ul></details>';
    html += '</main>';
    html += done ? '<div class="savebar"><div class="narrow"><span class="st">Your answers are saved.</span><a class="btn primary" href="#/">Back to home</a></div></div>'
      : '<div class="savebar"><div class="narrow"><span class="st" id="st">Your answers save automatically.</span><button class="btn good" id="submit">Submit</button></div></div>';
    render(html);

    // timer from the facilitator's Go live
    var st = S.acts[aid];
    if (!done && st && st.status === 'live' && sp.minutes) {
      var end = new Date(st.opened_at).getTime() + (st.duration_min || sp.minutes) * 60000, $t = document.getElementById('timer');
      var tick = function () { var left = (end - Date.now()) / 1000; $t.classList.remove('hide'); $t.classList.toggle('over', left <= 0); $t.textContent = left > 0 ? '⏱ ' + clock(left) + ' left' : '⏱ Time is up: finish and submit'; };
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
    function changed() {
      dirty = true; try { localStorage.setItem(key, JSON.stringify(A)); } catch (e) {}
      document.getElementById('st').textContent = 'Saving…';
      clearTimeout(changed.t); changed.t = setTimeout(save, 1200);
    }
    async function save() {
      if (saving) return; saving = true; dirty = false;
      var s = await sb.rpc('touch_attempt', { p_activity: aid, p_topic: tid, p_answers: payload() });
      saving = false;
      var $st = document.getElementById('st'); if (!$st) return;
      $st.textContent = s.error ? 'Not saved yet (connection?). We\'ll keep trying.' : 'Saved ✓ ' + new Date().toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });
      if (s.error || dirty) later(4000, save);
    }
    every(15000, function () { if (!dirty) sb.rpc('touch_attempt', { p_activity: aid, p_topic: tid, p_answers: null }); });
    bindBlocks(sp, A, changed);

    var $sub = document.getElementById('submit');
    $sub.onclick = async function () {
      var missing = sp.blocks.filter(function (b) {
        if (b.optional || b.type === 'rubric' || b.type === 'steps') return false;
        var v = A[b.id]; return v == null || v === '' || (Array.isArray(v) && !v.length) || (b.type === 'sort' && Object.keys(v).length < b.items.length);
      }).length;
      if (missing && !$sub.classList.contains('armed')) {
        $sub.classList.add('armed'); $sub.textContent = missing + ' not answered: submit anyway?';
        setTimeout(function () { $sub.classList.remove('armed'); $sub.textContent = 'Submit'; }, 5000); return;
      }
      $sub.disabled = true; $sub.textContent = 'Submitting…';
      var s = await sb.rpc('submit_attempt', { p_activity: aid, p_topic: tid, p_answers: payload() });
      if (s.error) { $sub.disabled = false; $sub.textContent = 'Submit'; toast(/ended/.test(s.error.message) ? 'This activity has ended.' : 'Couldn\'t submit. Check your connection and try again.'); return; }
      try { localStorage.removeItem(key); } catch (e) {}
      toast('Submitted!'); await loadState(); vActivity(aid);
    };
  }

  var LETTERS = 'ABCDEFGH';
  function blockHtml(b, v, f, done, i) {
    var h = b.prompt ? '<p class="p">' + esc(b.prompt) + (b.optional ? ' <span class="tag">optional</span>' : '') + '</p>' : '';
    var key = f && f.key;
    if (b.type === 'steps') {
      v = v || [];
      return '<p class="p">Steps · tick each one as you finish it</p>' + b.items.map(function (it, k) {
        var on = v.indexOf(k) >= 0;
        return '<label class="step' + (on ? ' on' : '') + '"><input type="checkbox" data-k="' + k + '"' + (on ? ' checked' : '') + (done ? ' disabled' : '') + '><span>' + esc(it) + '</span></label>';
      }).join('');
    }
    if (b.type === 'mcq') {
      v = v || [];
      h += b.multi ? '<p class="hint" style="margin-top:-6px">Pick all that apply.</p>' : '';
      h += b.options.map(function (o, k) {
        var on = v.indexOf(k) >= 0, cls = on ? ' on' : '';
        if (key) cls += key.mcq.indexOf(k) >= 0 ? ' right' : on ? ' wrong' : '';
        return '<button type="button" class="opt' + cls + '" data-k="' + k + '"' + (done ? ' disabled' : '') + '><span class="l">' + LETTERS[k] + '</span><span>' + esc(o) + '</span></button>';
      }).join('');
    } else if (b.type === 'number' || b.type === 'short') {
      h += '<input class="in" ' + (b.type === 'number' ? 'inputmode="decimal"' : 'autocapitalize="off" autocomplete="off" spellcheck="false"') +
        ' placeholder="' + esc(b.placeholder || (b.type === 'number' ? 'Type a number' : 'Type your answer')) + '" value="' + esc(v == null ? '' : v) + '"' + (done ? ' disabled' : '') + '>' +
        (b.unit ? '<div class="hint">' + esc(b.unit) + '</div>' : '');
    } else if (b.type === 'sort') {
      v = v || {};
      h += b.items.map(function (it) {
        return '<div class="sortrow"><div class="it">' + esc(it) + '</div><div class="bins">' + b.bins.map(function (bn, k) {
          var on = v[it] === k, cls = on ? ' on' : '';
          if (key && key.sort) cls = key.sort[it] === k ? (on ? ' right' : ' on right') : on ? ' wrong' : '';
          return '<button type="button" data-it="' + esc(it) + '" data-k="' + k + '" class="' + cls + '"' + (done ? ' disabled' : '') + '>' + esc(bn) + '</button>';
        }).join('') + '</div></div>';
      }).join('');
    } else if (b.type === 'text') {
      h += '<textarea class="in" rows="' + (b.lines || 4) + '" placeholder="' + esc(b.placeholder || 'Type your answer') + '"' + (done ? ' disabled' : '') + '>' + esc(v || '') + '</textarea>';
    } else if (b.type === 'upload') {
      h += (v && v.name ? '<p class="ok">✓ Uploaded: ' + esc(v.name) + '</p>' : '') +
        (done ? '' : '<input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.zip"><div class="hint">Photo, screenshot or file, up to 15 MB.' + (v ? ' Choosing another file replaces it.' : '') + '</div><div class="err"></div>');
    } else if (b.type === 'rubric') {
      h = '<p class="p">How your facilitator will score this</p><table class="rub">' + b.criteria.map(function (c) { return '<tr><td>' + esc(c.name) + '</td><td style="text-align:right;white-space:nowrap">' + c.points + ' pts</td></tr>'; }).join('') +
        '<tr><th>Total</th><th style="text-align:right">' + b.criteria.reduce(function (s, c) { return s + c.points; }, 0) + ' pts</th></tr></table>';
    }
    if (f) {
      var cls = f.points >= 1 ? 'right' : f.points > 0 ? 'part' : 'wrong';
      var ans = key.number != null ? Number(key.number).toLocaleString('en-PH') : key.short ? key.short[0] : '';
      h += '<div class="fb ' + cls + '"><b>' + (f.points >= 1 ? '✓ Correct' : f.points > 0 ? 'Partly right (' + Math.round(f.points * 100) + '%)' : '✗ Not quite') + '</b>' +
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
          el.querySelectorAll('.opt').forEach(function (x) { x.classList.toggle('on', v.indexOf(+x.dataset.k) >= 0); });
          changed();
        };
      });
      if (b.type === 'number' || b.type === 'short' || b.type === 'text') {
        var inp = el.querySelector('input,textarea'); inp.oninput = function () { A[b.id] = inp.value; changed(); };
      }
      if (b.type === 'sort') el.querySelectorAll('.bins button').forEach(function (btn) {
        btn.onclick = function () {
          var v = A[b.id] || {}; v[btn.dataset.it] = +btn.dataset.k; A[b.id] = v;
          btn.parentNode.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === btn); }); changed();
        };
      });
      if (b.type === 'upload') {
        var fi = el.querySelector('input[type=file]'); if (!fi) return;
        fi.onchange = async function () {
          var file = fi.files[0], $e = el.querySelector('.err'); if (!file) return;
          if (file.size > 15 * 1024 * 1024) { $e.textContent = 'That file is over 15 MB.'; return; }
          $e.textContent = ''; var hint = el.querySelector('.hint'); hint.textContent = 'Uploading ' + file.name + '…';
          var path = S.profile.id + '/' + sp.id + '/' + b.id + '-' + Date.now() + '-' + file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
          var r = await sb.storage.from('outputs').upload(path, file, { upsert: true, contentType: file.type || undefined });
          if (r.error) { hint.textContent = 'Photo, screenshot or file, up to 15 MB.'; $e.textContent = 'Upload failed: ' + errMsg(r.error); return; }
          A[b.id] = { path: path, name: file.name, type: file.type, size: file.size };
          hint.innerHTML = '<span class="ok">✓ Uploaded: ' + esc(file.name) + '</span>'; changed();
        };
      }
    });
  }

  // ---------- admin home
  async function vAdminHome() {
    var c = S.cohort, joinUrl = BASE + '?join=' + encodeURIComponent(c.join_code);
    var html = topbar() + '<main class="wrap" style="padding:20px 16px 48px">' +
      '<div class="card reg"><div class="qr" id="regqr">' + qr(joinUrl) + '</div><div class="stack">' +
      '<div class="muted small">' + esc(c.name) + ' · registration</div><div>Class code <span class="code">' + esc(c.join_code) + '</span></div>' +
      '<div class="linkbox"><span>' + esc(joinUrl.replace(/^https?:\/\//, '')) + '</span><button class="btn small" id="cpj">Copy</button></div>' +
      '<div class="row"><div><span class="big" id="nreg">…</span> <span class="muted">registered</span></div><button class="btn gold" id="full">Show full screen for Zoom</button></div></div></div>';
    CAT.forEach(function (m, mi) {
      html += '<section class="module" style="--c:var(--m' + (mi + 1) + ')"><span class="k">' + esc(m.n + ' · ' + m.day) + '</span><h3>' + esc(m.title) + '</h3><div class="topics">';
      m.topics.forEach(function (t) {
        var open = topicOpen(t.id);
        var live = t.activities.filter(function (a) { return S.acts[a.id] && S.acts[a.id].status === 'live'; }).length;
        html += '<div class="topic"><div class="t"><span class="num">' + t.id + '</span><h4>' + esc(t.title) + '</h4></div>' +
          '<div class="row small">' + (open ? '<span class="tag open">Open to participants</span>' : '<span class="tag">🔒 Locked</span>') + (live ? '<span class="tag live">● ' + live + ' live</span>' : '') +
          '<span class="muted">' + t.activities.length + ' activities</span></div>' +
          '<div class="row"><a class="btn small primary" href="#/present/' + t.id + '">Present</a>' +
          '<button class="btn small" data-tog="' + t.id + '">' + (open ? 'Lock' : 'Start') + '</button>' +
          '<a class="btn small" href="#/results/' + t.id + '">Results</a></div></div>';
      });
      html += '</div></section>';
    });
    render(html + '</main>');
    document.getElementById('cpj').onclick = function () { copy(joinUrl); };
    document.getElementById('full').onclick = function () { qrFull(joinUrl, c.join_code, 'Scan to register'); };
    document.querySelectorAll('[data-tog]').forEach(function (b) { b.onclick = function () { setTopic(b.dataset.tog, !topicOpen(b.dataset.tog)).then(vAdminHome); }; });
    async function count() {
      var r = await sb.from('profiles').select('id', { count: 'exact', head: true }).eq('cohort_id', c.id).eq('role', 'participant');
      var n = document.getElementById('nreg'); if (n) n.textContent = r.count == null ? '?' : r.count;
      var f = document.getElementById('fullcount'); if (f) f.textContent = r.count;
    }
    count(); every(5000, count);
  }

  function qrFull(url, code, title) {
    $modal.innerHTML = '<div class="qrfull" id="qf"><div style="font-size:clamp(22px,3vw,36px);font-weight:800">' + esc(title) + '</div>' +
      '<div class="qrbox">' + qr(url) + '</div><div class="code">' + esc(code) + '</div><div class="lnk">' + esc(url.replace(/^https?:\/\//, '')) + '</div>' +
      '<div class="row" style="justify-content:center"><span><b id="fullcount" style="font-size:28px">…</b> registered</span><button class="btn" id="qfc">Copy link</button><button class="btn gold" id="qfx">Close</button></div></div>';
    document.getElementById('qfc').onclick = function () { copy(url); };
    document.getElementById('qfx').onclick = function () { $modal.innerHTML = ''; };
  }

  async function setTopic(tid, open) {
    var r = await sb.from('topic_state').upsert({ cohort_id: S.profile.cohort_id, topic_id: tid, status: open ? 'open' : 'locked', opened_at: open ? new Date().toISOString() : null });
    if (r.error) toast(errMsg(r.error)); else { toast(tid + (open ? ' is open to participants' : ' is locked')); await loadState(); }
  }

  // ---------- presenter: deck + Go live panel
  function vPresent(tid) {
    var T = TOPIC[tid].t, cid = S.profile.cohort_id, current = null, liveId = null, panelHidden = false;
    var opts = T.activities.map(function (a) { return '<option value="' + a.id + '">' + esc(a.title) + '</option>'; }).join('');
    render('<div class="present"><div class="pbar"><a href="#/">⌂ Home</a><span class="t">' + tid + ' ' + esc(T.title) + '</span>' +
      '<button class="golive hide" id="golive"></button>' +
      '<select id="pick" aria-label="Go live with an activity"><option value="">Go live with…</option>' + opts + '</select>' +
      '<button class="hide" id="showlive">● Live panel</button>' +
      '<a class="res" href="#/results/' + tid + '" id="resbtn">Results →</a></div>' +
      '<div class="lockbar' + (topicOpen(tid) ? ' hide' : '') + '" id="lockbar">🔒 This topic is locked for participants.<button id="openit">Start topic</button></div>' +
      '<div class="pbody"><iframe id="deck" src="course/' + encodeURIComponent(T.deck) + '" title="' + esc(T.title) + '" allow="autoplay; fullscreen" allowfullscreen></iframe><aside class="livepanel hide" id="live"></aside></div></div>');
    var $f = document.getElementById('deck'), $go = document.getElementById('golive'), $live = document.getElementById('live');
    document.getElementById('openit').onclick = function () { setTopic(tid, true).then(function () { document.getElementById('lockbar').classList.add('hide'); }); };
    document.getElementById('pick').onchange = function () { if (this.value) goLive(this.value); this.value = ''; };
    document.getElementById('showlive').onclick = function () { panelHidden = false; showPanel(); };
    $f.onload = function () { try { $f.contentWindow.focus(); } catch (e) {} };

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
        if (a) $go.textContent = (S.acts[a.id] && S.acts[a.id].status === 'live' ? '● Show live: ' : '● Go live: ') + a.title;
      }
      document.getElementById('resbtn').style.outline = idx === all.length - 1 ? '3px solid #fff' : '';
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
      var a = ACT[liveId].a, url = BASE + '?a=' + liveId, st = S.acts[liveId];
      $live.classList.toggle('hide', panelHidden);
      document.getElementById('showlive').classList.toggle('hide', !panelHidden);
      $live.innerHTML = '<div class="row" style="justify-content:space-between"><span class="tag live">' + (st.status === 'live' ? '● LIVE' : 'Ended') + '</span><span class="timer" id="ptimer" style="background:var(--bg);margin:0"></span></div>' +
        '<h3>' + esc(a.title) + '</h3><div class="qrbig">' + qr(url) + '</div>' +
        '<div class="short">' + esc(SHORT + '?a=' + liveId) + '</div><button class="btn primary block" id="cpl">Copy link for the chat</button>' +
        '<div class="counts"><div><b id="c-acc">…</b><span>accessed<br>of <span id="c-reg">…</span> registered</span></div><div><b id="c-fin">…</b><span>finished</span></div><div><b id="c-act">…</b><span>working now</span></div></div>' +
        '<div class="row"><button class="btn small" id="restart">Restart timer</button>' + (st.status === 'live' ? '<button class="btn small danger" id="end">End activity</button>' : '<button class="btn small" id="reopen">Reopen</button>') +
        '<button class="btn small" id="hidep">Hide panel</button></div>';
      document.getElementById('cpl').onclick = function () { copy(url); };
      document.getElementById('hidep').onclick = function () { panelHidden = true; showPanel(); };
      document.getElementById('restart').onclick = function () { setAct({ status: 'live', opened_at: new Date().toISOString() }); };
      var e = document.getElementById('end'); if (e) armed(e, 'Tap again to end', function () { setAct({ status: 'ended' }); });
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
      var sl = document.getElementById('showlive'); if (sl) sl.textContent = '● Live ' + d.finished + '/' + d.registered + ' finished';
    }
    every(3000, counts);
    every(1000, function () {
      var $t = document.getElementById('ptimer'); if (!$t || !liveId) return;
      var st = S.acts[liveId], end = new Date(st.opened_at).getTime() + (st.duration_min || 0) * 60000, left = (end - Date.now()) / 1000;
      $t.textContent = st.duration_min ? (left > 0 ? '⏱ ' + clock(left) : '⏱ Time') : '';
    });
    // reopen the panel if an activity of this topic is already live
    var already = T.activities.find(function (a) { return S.acts[a.id] && S.acts[a.id].status === 'live'; });
    if (already) { liveId = already.id; panelHidden = true; showPanel(); }
  }

  // ---------- results dashboard
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
    var html = topbar() + '<main class="wrap" style="padding:20px 16px 0"><p class="muted small" style="margin:0">' + esc(M.n + ' · ' + M.title) + '</p>' +
      '<h1 style="margin:4px 0 0;letter-spacing:-.02em">' + tid + ' ' + esc(T.title) + ': results</h1>' +
      '<div class="row" style="margin-top:10px"><a class="btn small" href="#/present/' + tid + '">← Back to slides</a><button class="btn small" id="refresh">Refresh</button><span class="small muted">' + nreg + ' registered</span></div>';
    var uploads = [];
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
          html += '<div style="margin-top:14px"><p class="p" style="font-weight:700;margin:0">' + esc(b.prompt) + '</p>' + b.options.map(function (o, i) {
            var n = vals.filter(function (x) { return x.v.indexOf(i) >= 0; }).length, right = kk && kk.mcq.indexOf(i) >= 0;
            return '<div class="bar' + (right ? ' right' : '') + '"><span class="lbl">' + LETTERS[i] + '. ' + esc(o) + (right ? ' ✓' : '') + '</span><span class="tr"><i style="width:' + pct(n, vals.length) + '%"></i></span><b>' + n + '</b></div>';
          }).join('') + '</div>';
        } else if (b.type === 'number' || b.type === 'short' || b.type === 'sort') {
          var ok = sub.filter(function (x) { var f = x.feedback && x.feedback[b.id]; return f && f.points >= 1; }).length;
          var wrong = {};
          if (b.type !== 'sort') vals.forEach(function (x) { var f = x.at.feedback && x.at.feedback[b.id]; if (!(f && f.points >= 1)) { var s = String(x.v).trim(); wrong[s] = (wrong[s] || 0) + 1; } });
          var top = Object.keys(wrong).sort(function (p, q) { return wrong[q] - wrong[p]; }).slice(0, 4);
          var ans = kk ? (kk.number != null ? Number(kk.number).toLocaleString('en-PH') : kk.short ? kk.short[0] : '') : '';
          html += '<div style="margin-top:14px"><p style="font-weight:700;margin:0">' + esc(b.prompt) + '</p><div class="bar right"><span class="lbl">' + (ans ? 'Answer ' + esc(ans) : 'All correct') + '</span><span class="tr"><i style="width:' + pct(ok, sub.length) + '%"></i></span><b>' + pct(ok, sub.length) + '%</b></div>' +
            (top.length ? '<div class="small muted">Common wrong answers: ' + top.map(function (s) { return '<b>' + esc(s) + '</b> (' + wrong[s] + ')'; }).join(', ') + '</div>' : '') + '</div>';
          if (b.type === 'sort' && kk) html += '<div class="small">' + b.items.map(function (it) {
            var n = vals.filter(function (x) { return x.v[it] === kk.sort[it]; }).length;
            return '<div class="bar' + (pct(n, vals.length) >= 75 ? ' right' : '') + '"><span>' + esc(it) + ' → ' + esc(b.bins[kk.sort[it]]) + '</span><span class="tr"><i style="width:' + pct(n, vals.length) + '%"></i></span><b>' + pct(n, vals.length) + '%</b></div>';
          }).join('') + '</div>';
        } else if (b.type === 'steps') {
          var all = sub.filter(function (x) { return (x.answers[b.id] || []).length === b.items.length; }).length;
          html += '<p class="small" style="margin-top:14px"><b>Steps:</b> ' + all + ' of ' + sub.length + ' ticked every step.</p>';
        } else if (b.type === 'text') {
          html += '<div style="margin-top:14px"><p style="font-weight:700;margin:0 0 6px">' + esc(b.prompt) + ' <span class="muted small">(' + vals.length + ')</span></p><div class="answers">' +
            (vals.map(function (x) { return '<div><b>' + esc(fullName(x.p)) + ':</b> ' + esc(x.v) + '</div>'; }).join('') || '<div class="muted">No answers yet.</div>') + '</div></div>';
        } else if (b.type === 'upload') {
          var gid = 'g-' + a.id.replace('.', '-') + '-' + b.id;
          html += '<div style="margin-top:14px"><p style="font-weight:700;margin:0 0 6px">' + esc(b.prompt) + ' <span class="muted small">(' + vals.length + ')</span></p><div class="gallery" id="' + gid + '">' +
            (vals.length ? '' : '<span class="muted small">No files yet.</span>') + '</div></div>';
          vals.forEach(function (x) { uploads.push({ gid: gid, path: x.v.path, name: x.v.name, type: x.v.type, who: fullName(x.p) }); });
        } else if (b.type === 'rubric') {
          html += rubricTable(a, b, sub, people);
        }
      });
      var notyet = parts.filter(function (p) { return !sub.some(function (x) { return x.user_id === p.id; }); });
      if (notyet.length && sub.length) html += '<details style="margin-top:12px"><summary class="small">Not submitted yet (' + notyet.length + ')</summary><p class="small">' + notyet.map(fullName).map(esc).join(', ') + '</p></details>';
      html += '</section>';
    });
    var mt = M.topics, i = mt.findIndex(function (t) { return t.id === tid; }), nx = mt[i + 1];
    html += '<div class="next">' + (nx ? '<a class="btn" href="#/">Home</a><a class="btn primary" href="#/present/' + nx.id + '">Next: ' + nx.id + ' ' + esc(nx.title) + ' →</a>'
      : '<span class="muted" style="align-self:center">End of ' + esc(M.n) + '.</span><a class="btn primary" href="#/">Back to Home</a>') + '</div></main>';
    render(html);
    document.getElementById('refresh').onclick = function () { vResults(tid); };
    bindRubrics(tid);
    if (uploads.length) {
      var su = await sb.storage.from('outputs').createSignedUrls(uploads.map(function (u) { return u.path; }), 3600);
      (su.data || []).forEach(function (s, k) {
        var u = uploads[k], g = document.getElementById(u.gid); if (!g || !s.signedUrl) return;
        g.insertAdjacentHTML('beforeend', '<a href="' + esc(s.signedUrl) + '" target="_blank" rel="noopener">' +
          (/^image\//.test(u.type) ? '<img src="' + esc(s.signedUrl) + '" alt="">' : '<span style="font-size:28px;padding:20px 8px 0">📄</span>') +
          '<span><b>' + esc(u.who) + '</b><br>' + esc(u.name) + '</span></a>');
      });
    }
  }

  function rubricTable(a, b, sub, people) {
    var tot = b.criteria.reduce(function (s, c) { return s + c.points; }, 0);
    return '<div style="margin-top:14px" class="scroll-x"><p style="font-weight:700;margin:0 0 6px">Score the lab (rubric, ' + tot + ' pts)</p><table class="people"><tr><th>Participant</th>' +
      b.criteria.map(function (c) { return '<th title="' + esc(c.name) + '">' + esc(c.name.length > 22 ? c.name.slice(0, 20) + '…' : c.name) + '<br><span class="muted">/' + c.points + '</span></th>'; }).join('') + '<th>Total</th><th></th></tr>' +
      (sub.map(function (x) {
        var rb = x.rubric || {};
        return '<tr data-att="' + x.id + '" data-act="' + a.id + '"><td>' + esc(fullName(people[x.user_id])) + '</td>' + b.criteria.map(function (c, k) {
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
    render(topbar() + '<main class="wrap" style="padding:20px 16px 48px"><div class="row" style="justify-content:space-between"><h1 style="margin:0">People (' + ps.length + ')</h1>' +
      '<div class="row"><button class="btn" id="csv1">Download participants (CSV)</button><button class="btn" id="csv2">Download scores (CSV)</button></div></div>' +
      '<div class="scroll-x" style="margin-top:14px"><table class="people"><tr><th>Name (certificate)</th><th>Email</th><th>Organization</th><th>Position</th><th>Registered</th><th>Submitted</th></tr>' +
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
    route();
  })();
})();
