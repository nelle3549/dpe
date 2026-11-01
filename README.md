# Digital Productivity Essentials · course site and LMS

DICT ILCDB course *Digital Productivity Essentials*, delivered for BIR Misamis Oriental by Serial Disruptors.
Static site on GitHub Pages; sign-up, activity answers and scores live in Supabase (Row Level Security on).

| Path | What |
|---|---|
| `index.html`, `app/` | The LMS: registration, topics, activity pages, facilitator presenter and results |
| `course/` | The 26 topic decks, narrated videos and images (copied from Google Drive by `tools/sync.py`) |
| `activities/` | Activity pages per topic (questions only; answer keys are stored only in the database) |
| `tools/sync.py` | Refresh `course/`, `activities/` and `app/catalog.js` from the Drive folder |
| `tools/keys_sql.py` | SQL to load the answer keys from Drive into Supabase |
| `.github/workflows/keepalive.yml` | Daily database ping so the free Supabase project is not paused |

The database schema lives in Drive: `LMS/sql/schema.sql`.

Credits: photos from Unsplash; narration by ElevenLabs; music by Kevin MacLeod (incompetech.com), CC BY 4.0.
