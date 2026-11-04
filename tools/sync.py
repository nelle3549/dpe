"""Copy the course from Google Drive into this repo and rebuild app/catalog.js.

usage: python3 tools/sync.py
Source of truth stays in Drive:
  Decks/                -> course/      (decks, assets, images, videos; not _to delete/)
  LMS/activities/*.json -> activities/  (no answer keys: those go to the database only)
"""
import json, os, re, shutil

SRC = os.path.expanduser('~/My Drive/Nelle 2nd Brain/DICT - Digital Productivity Essentials Training')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def copy_tree(src, dst, skip=('_to delete', '.DS_Store')):
    if os.path.exists(dst):
        shutil.rmtree(dst)
    shutil.copytree(src, dst, ignore=lambda d, names: [n for n in names if n in skip])


copy_tree(f'{SRC}/Decks', f'{REPO}/course')
copy_tree(f'{SRC}/LMS/activities', f'{REPO}/activities')


def drop(html, start):
    """Remove every element whose opening tag matches `start`, with all its contents (nesting-aware)."""
    out, i = [], 0
    for m in re.finditer(start, html):
        if m.start() < i:
            continue
        tag = re.match(r'<(\w+)', m[0])[1]
        depth, j = 0, m.start()
        for t in re.finditer(rf'<(/?){tag}\b[^>]*>', html[m.start():]):
            depth += -1 if t[1] else 1
            if not depth:
                j = m.start() + t.end()
                break
        out.append(html[i:m.start()])
        i = j
    return ''.join(out) + html[i:]


def participant_copy(html):
    """The deck without speaker notes, answer reveals, option explanations or right-answer markers.
    Help blocks marked class="answer keep" (hints, quick fixes, task data) stay in."""
    html = re.sub(r'<!--.*?-->', '', html, flags=re.S)
    for start in (r'<div class="notes"', r'<aside class="notes"', r'<(div|span) class="answer(?! keep)[ "]', r'<div class="why"'):
        html = drop(html, start)
    html = re.sub(r'\sdata-correct\b', '', html)
    return html.replace('<head>', '<head>\n<base href="../">', 1)


# practice files: Decks/files/<topic>/files.json lists each starter file and the slides that use it;
# those slides get a download chip (in the caption under a screenshot, else in the slide heading)
from urllib.parse import quote
from html import escape as esc
FILES = {}
for tid in sorted(os.listdir(f'{REPO}/course/files')) if os.path.isdir(f'{REPO}/course/files') else []:
    man = f'{REPO}/course/files/{tid}/files.json'
    if not os.path.isfile(man):
        continue
    FILES[tid] = json.load(open(man, encoding='utf-8'))
    for x in FILES[tid]:
        f = f'{REPO}/course/files/{tid}/{x["file"]}'
        assert os.path.isfile(f), f
        x['size'] = os.path.getsize(f)
DL = ('<svg class="ico" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
      'stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>')


def add_chips(html, tid):
    com = [(m.start(), m.end()) for m in re.finditer(r'<!--.*?-->', html, re.S)]
    out, last = [], 0
    for m in re.finditer(r'<section class="slide[^"]*"[^>]*data-title="([^"]*)"[^>]*>.*?</section>', html, re.S):
        if any(a <= m.start() < b for a, b in com):
            continue
        fs = [x for x in FILES.get(tid, []) if m[1] in x.get('slides', [])]
        if not fs:
            continue
        chips = ''.join(f'<a class="dlchip" href="files/{tid}/{quote(x["file"])}" download="{esc(x["file"])}" title="Download: {esc(x["desc"])}">{DL} {esc(x["title"])}</a>' for x in fs)
        sec = m[0]
        if re.search(r'<p class="cap"[^>]*>', sec):
            sec = re.sub(r'(<p class="cap"[^>]*>.*?)(</p>)', lambda k: k[1] + ' ' + chips + k[2], sec, count=1, flags=re.S)
        elif '<div class="slide-head">' in sec:
            i, depth = sec.index('<div class="slide-head">'), 0
            for t in re.finditer(r'<(/?)div\b[^>]*>', sec[i:]):   # the slide-head's own closing tag
                depth += -1 if t[1] else 1
                if not depth:
                    j = i + t.start(); break
            sec = sec[:j] + '<span class="dlchips">' + chips + '</span>' + sec[j:]
        else:
            sec = re.sub(r'^(<section[^>]*>)', lambda k: k[1] + '<span class="dlchips abs">' + chips + '</span>', sec, count=1)
        out.append(html[last:m.start()] + sec); last = m.end()
    return ''.join(out) + html[last:]


for f in os.listdir(f'{REPO}/course'):
    if f.startswith('Deck - ') and f.endswith('.html'):
        tid = f.split(' ')[2]
        if tid in FILES:
            p = f'{REPO}/course/{f}'
            html = add_chips(open(p, encoding='utf-8').read(), tid)
            open(p, 'w', encoding='utf-8').write(html)

# participants load course/p/<deck>: the same slides with the answers left out of the page source
os.makedirs(f'{REPO}/course/p')
for f in os.listdir(f'{REPO}/course'):
    if f.startswith('Deck - ') and f.endswith('.html'):
        html = participant_copy(open(f'{REPO}/course/{f}', encoding='utf-8').read())
        assert 'data-correct' not in html and 'class="notes"' not in html and 'class="why"' not in html, f
        open(f'{REPO}/course/p/{f}', 'w', encoding='utf-8').write(html)

# version the decks' and videos' scripts and styles too (?v=<hash>), so phones never mix a new deck with a cached old dpe.js
import hashlib
def _ver(path):
    return hashlib.sha1(open(path, 'rb').read()).hexdigest()[:8]
def stamp_course(html_path, base):
    html = open(html_path, encoding='utf-8').read()
    def rep(m):
        f = os.path.normpath(os.path.join(base, m[2]))
        return f'{m[1]}="{m[2]}?v={_ver(f)}"' if os.path.isfile(f) else m[0]
    open(html_path, 'w', encoding='utf-8').write(re.sub(r'(src|href)="((?:\.\./)?(?:assets/[\w./-]+|[\w.-]+)\.(?:js|css))"', rep, html))
for f in os.listdir(f'{REPO}/course'):
    if f.startswith('Deck - ') and f.endswith('.html'):
        stamp_course(f'{REPO}/course/{f}', f'{REPO}/course')
        stamp_course(f'{REPO}/course/p/{f}', f'{REPO}/course')   # <base href="../">: same paths as the deck
for d in os.listdir(f'{REPO}/course/videos'):
    if os.path.isfile(f'{REPO}/course/videos/{d}/index.html'):
        stamp_course(f'{REPO}/course/videos/{d}/index.html', f'{REPO}/course/videos/{d}')

def slide_no(slides, a):
    """Which slide (1-based) shows this activity: its data-title first, else its title in the slide text."""
    by_title = [i for i, (attrs, _) in enumerate(slides) if f'data-title="{a["slide"]}"' in attrs]
    if len(by_title) == 1:
        return by_title[0] + 1
    want = a['title'].split(':')[-1].strip().lower()
    for i, (_, body) in enumerate(slides):
        body = re.sub(r'<(aside|div) class="notes".*?</\1>', '', body, flags=re.S)
        if want in re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', body)).lower():
            return i + 1
    return None


# catalog from the course index (modules, topics, deck files, video lengths) + activity titles
idx = open(f'{SRC}/Decks/index.html').read()
mods = []
for m in re.finditer(r"\{id:'(m\d)', c:'[^']*', n:'([^']*)', h:'([^']*)', day:'([^']*)', title:'([^']*)',\s*desc:'([^']*)'", idx):
    mods.append(dict(id=m[1], n=m[2], hours=m[3], day=m[4], title=m[5], desc=m[6], topics=[]))
vlen = json.loads(re.search(r'const VLEN = (\{.*?\});', idx)[1])
for m in re.finditer(r"D\('(\d\.\d)','((?:[^'\\]|\\.)*)','([^']*)','((?:[^'\\]|\\.)*)',\[(.*?)\]", idx):
    tid, title, dur, desc = m[1], m[2].replace("\\'", "'"), m[3], m[4].replace("\\'", "'")
    parts = [x.replace("\\'", "'") for x in re.findall(r"'((?:[^'\\]|\\.)*)'", m[5])]   # the topic's highlights
    deck = f'Deck - {tid} {title} - 2026-11-01.html'
    assert os.path.exists(f'{REPO}/course/{deck}'), deck
    spec = json.load(open(f'{REPO}/activities/{tid}.json'))
    slides = re.findall(r'<section class="slide[^"]*"([^>]*)>(.*?)</section>', re.sub(r'<!--.*?-->', '', open(f'{REPO}/course/{deck}').read(), flags=re.S), re.S)
    acts = [dict(id=a['id'], kind=a['kind'], title=a['title'], slide=a['slide'], minutes=a['minutes'],
                 slideNo=slide_no(slides, a)) for a in spec['activities']]
    # practice files for the activity page: the ones its slide uses; a hands-on task or lab with none gets all the topic's files
    for a, sa in zip(acts, spec['activities']):
        fs = [x['file'] for x in FILES.get(tid, []) if sa['slide'] in x['slides']]
        a['files'] = fs or ([x['file'] for x in FILES.get(tid, [])] if a['kind'] in ('task', 'lab') else [])
    # the slide's countdown should match the portal timer the facilitator starts with Go live
    for a in acts:
        t = a['slideNo'] and re.search(r'data-min="([\d.]+)"', slides[a['slideNo'] - 1][1])
        if t and float(t[1]) >= 1 and float(t[1]) != a['minutes']:   # sub-minute ones are reading tests
            print(f'warning: {a["id"]} slide timer {t[1]} min, portal {a["minutes"]} min')
    mods[int(tid[0]) - 1]['topics'].append(dict(id=tid, title=title, dur=dur, desc=desc, parts=parts, deck=deck,
                                               video=vlen.get(tid), slides=len(slides), activities=acts,
                                               files=[{k: x[k] for k in ('file', 'title', 'desc', 'size')} for x in FILES.get(tid, [])]))
n = sum(len(m['topics']) for m in mods)
assert len(mods) == 4 and n == 26, (len(mods), n)
open(f'{REPO}/app/catalog.js', 'w').write('// generated by tools/sync.py\nwindow.CATALOG = ' +
                                          json.dumps(mods, ensure_ascii=False, indent=1) + ';\n')
print(f'synced: 4 modules, {n} topics, {sum(len(t["activities"]) for m in mods for t in m["topics"])} activities')

# version the app files in index.html, so browsers load each update instead of a cached copy
import hashlib
html = open(f'{REPO}/index.html').read()
def stamp(m):
    v = hashlib.sha1(open(f'{REPO}/app/{m[1]}', 'rb').read()).hexdigest()[:8]
    return f'app/{m[1]}?v={v}"'
open(f'{REPO}/index.html', 'w').write(re.sub(r'app/([a-z]+\.(?:js|css))(?:\?v=\w+)?"', stamp, html))
