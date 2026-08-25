# 🏝️ Hiring Island

**Remote tech jobs, ranked by how remote they actually are.**

→ **[qwamzz.github.io/hiring-island](https://qwamzz.github.io/hiring-island)**

---

## The problem

Every job board treats "Remote" as one thing. It isn't.

In the current index, **1,962 remote tech roles → 203 of them (10%) will hire you
across a border.** The other 90% are remote *inside one country* — usually the
United States. If you're not in that country, those listings are noise, and no
board tells you which is which until you've opened the posting.

Hiring Island grades every posting by the geography it actually frees you from,
puts the grade on the card, and sorts by it.

| Grade | Meaning |
|-------|---------|
| **Work from anywhere** | The employer explicitly said worldwide / any country |
| **Multi-region** | Three or more countries, or a stated multi-continent region |
| **Two countries** | Exactly two |
| **Single country** | One — labelled honestly, not hidden |
| **Location unstated** | The posting doesn't say, and we won't guess |

### The rule that makes the grade worth trusting

**Absence of data is never evidence of freedom.** A posting that lists no
countries is `unspecified`, never `worldwide`.

This is not theoretical. The first build of this repo graded **186 US-only
roles as "work from anywhere"** because an empty country list was read as "no
restriction", and because the location parser didn't recognise
`San Francisco, CA` as the United States. A later pass promoted a Lyft role
in `Ukraine Anywhere` to the top tier on the strength of the word "anywhere".
Both are now regression tests in `tests/freedom.test.ts`, which is the file to
read first if you change anything in `src/freedom.ts`.

## Sources

| Source | Access | Notes |
|--------|--------|-------|
| [HiringCafe](https://hiring.cafe) | Public server-rendered pages | Their search API needs a session credential. The SEO pages under `/jobs/<keyword>-remote` embed complete job objects in a `__NEXT_DATA__` island — including `workplace_countries`, `workplace_continents` and `is_workplace_worldwide_ok`, which is what this whole site is built on. |
| [Greenhouse](https://developers.greenhouse.io/job-board.html) | Official public Job Board API | Documented, unauthenticated. No cross-company search, so `boards.txt` is the search space. Geography is inferred from free-text location, conservatively. |

Both are read politely: an honest User-Agent, exponential backoff on 429/5xx,
bounded concurrency, and a once-daily schedule. Every **Apply** link goes to the
employer's own posting — no redirect, no account, no tracking.

## Running it

```bash
bun install
bun test          # 31 tests, all network-free
bun run build     # writes site/data/jobs.json
```

Then serve `site/` however you like:

```bash
python -m http.server 8791 --directory site
```

`PAGES_PER_QUERY` (default 3) controls how deep each keyword sweep goes —
20 results per page.

## Configuring

| File | What it controls |
|------|------------------|
| `queries.txt` | Role keywords swept against HiringCafe. Each line is `PAGES_PER_QUERY` requests per build, so keep it focused. |
| `boards.txt` | Greenhouse board tokens. Every token shipped here was verified live. |

**Growing `boards.txt`** is the highest-leverage change you can make. Results
carry `boardToken` for employers on Greenhouse, so the aggregator sweep tells
you exactly who to add:

```bash
bun -e 'const d=require("./site/data/jobs.json");
  console.log([...new Set(d.jobs.filter(j=>j.source==="greenhouse"&&j.boardToken).map(j=>j.boardToken))].sort().join("\n"))'
```

## Layout

```
src/
  types.ts              Job / SiteData shapes
  freedom.ts            The grading rules — the heart of the site
  sources/hiringcafe.ts __NEXT_DATA__ parsing, salary annualisation
  sources/greenhouse.ts Board API, free-text geography inference
  build.ts              Sweep, dedupe, sort, write
site/                   The published static site (no framework, no build step)
tests/freedom.test.ts   Regression tests for every grading bug found so far
```

Deployed by `.github/workflows/deploy.yml` — daily at 05:17 UTC, plus on push
and on demand. The build **refuses to write an empty index**, so an upstream
outage leaves the last good site standing rather than publishing a blank board.

## Honest limits

- **Coverage is not complete.** It's `queries.txt` × HiringCafe, plus whichever
  Greenhouse boards are listed. Plenty of remote jobs are in neither.
- **Greenhouse geography is inferred from free text** and will be wrong at the
  margins. HiringCafe's country data is a real field and is trusted directly.
- **`estimated_publish_date` is HiringCafe's estimate**, not the employer's
  timestamp. Treat "posted 3d ago" as approximate.
- **Salary is only shown when the posting states it** — about 30% of the index.
  Nothing is estimated or imputed.
- Not affiliated with HiringCafe, Greenhouse, or any employer listed.

## Licence

MIT. Portions of the HiringCafe endpoint research derive from
[MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search) (MIT).
