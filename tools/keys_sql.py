"""Print SQL that loads the answer keys (kept in Google Drive, never in this public repo).

usage: python3 tools/keys_sql.py > /tmp/keys.sql     then run it in the Supabase SQL editor
"""
import glob, json, os

KEYS = os.path.expanduser('~/My Drive/Nelle 2nd Brain/DICT - Digital Productivity Essentials Training/LMS/keys')
rows = []
for p in sorted(glob.glob(f'{KEYS}/*.json')):
    topic = os.path.basename(p)[:-5]
    for aid, key in json.load(open(p)).items():
        rows.append("('%s', '%s', $k$%s$k$::jsonb)" % (aid, topic, json.dumps(key, ensure_ascii=False)))
print('insert into public.activity_keys (activity_id, topic_id, key) values\n  ' + ',\n  '.join(rows) +
      '\non conflict (activity_id) do update set topic_id = excluded.topic_id, key = excluded.key;')
