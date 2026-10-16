# 🎯 Job-Copilot

> **⚡ Local-first job copilot with FastAPI, React, Chrome MV3, and pluggable LLMs (Ollama / Gemini). Verifiable claim engine, ATS autofill, and Gmail outcome tracking.**

A job-search and application copilot that produces evidence-cited applications and tracks confirmed outcomes, using only authorized access.

- Design document: [docs/design.md](docs/design.md)

## Status: MVP complete (backend, worker, Gmail, console, extension)

Built and tested against PostgreSQL:

| Area | What exists |
|---|---|
| Profile | Resume text import → proposed facts; verify / reject / revise (supersede, never edit); answer bank with staleness |
| Ingestion | Pasted jobs; Greenhouse and Lever public board adapters; cross-source dedupe into canonical jobs; manual split; closed/stale detection; raw snapshots |
| Matching | Hard filters before any model call; rule-based requirement extraction, optionally refined by a model in the worker (terms and years the description does not contain are dropped; old requirements are retired, not deleted); requirement → fact mapping; score computed in code with breakdown |
| Generation | Claims stored as rows citing facts; validator rejects uncited claims, unverified facts, and skills or numbers not in the cited facts; LLM generation with bounded retries, then escalation to the manual queue; re-validation at approval |
| Lifecycle | State machine; no confirmation without evidence; optimistic locking; idempotent evidence; append-only event and audit logs enforced by triggers; erasure by cascading user delete |
| Operations | Per-call LLM logging (prompt hash only), monthly spend cap, funnel analytics |
| Worker | Procrastinate queue in PostgreSQL: inbox sync every 15 min, board polls every 6 h, stale marking daily, re-scoring when facts or preferences change; retries; crash-safe |
| Inbox | Gmail read-only; rule-based classification (confirmation, rejection, assessment, interview, offer, job alert); email → application matching; confident matches update the application, the rest wait in the inbox queue; bodies never stored |
| Job alerts | LinkedIn and Naukri alert emails become jobs (title, company, location, link; tracking parameters dropped); they merge with the same role from a company board, which brings the description and a score |
| Off-system applications | A confirmation for an application made elsewhere (Naukri NEO, LinkedIn Easy Apply, a careers page) that names the role and company starts tracking it as confirmed; later replies match it. Vaguer emails can be imported by hand |
| PDFs | Tailored resume and answers sheet rendered from approved claims, verified facts and the answer bank (fpdf2 by default; optional user-owned LaTeX resume template) |
| API | FastAPI under `/api`, bearer-token auth; OpenAPI at `/docs`; TypeScript types generated into `shared/api.d.ts` |
| Web console | React + Vite in `console/`, served by FastAPI at `/`: jobs with score breakdown and requirement → fact evidence, pipeline, claim editor showing validator issues per claim, approval, PDFs, inbox queue, fact verification, answers, filters, boards, insights. Works at phone width |
| Extension | Chrome MV3 in `extension/`: Greenhouse and Lever adapters fill a form when you click Fill, attach the tailored resume, outline what they filled and flag required fields left for you; never ticks consent boxes or presses Submit; records your submission and captures the confirmation page as evidence |

Model choice: `JOBCOPILOT_LLM_PROVIDER=ollama|gemini|hosted` writes content. Gemini uses
`JOBCOPILOT_GEMINI_API_KEY` and `JOBCOPILOT_GEMINI_MODEL`; hosted vendors use the OpenAI-compatible settings.
Hosted providers are refused personal data unless their matching `*_ALLOWS_PERSONAL_DATA=true` setting is enabled.
Switch vendors by changing `JOBCOPILOT_LLM_PROVIDER` and restarting the backend. `JOBCOPILOT_REQUIREMENT_EXTRACTOR=llm`
turns on model extraction; job descriptions are public, so a configured free provider is fine there.

## Running locally (Windows, no Docker)

```powershell
./scripts/dev-db.ps1 start                 # PostgreSQL on localhost:5433, data in data/pg
cd backend
python -m venv .venv; .venv\Scripts\pip install -e ".[dev]"
copy .env.example .env                     # optionally set JOBCOPILOT_API_TOKEN for legacy/admin access
.venv\Scripts\alembic upgrade head
.venv\Scripts\uvicorn jobcopilot.main:app --reload    # terminal 1: API
.venv\Scripts\jobcopilot worker                       # terminal 2: background worker
.venv\Scripts\pytest                                  # uses the jobcopilot_test database
```

`jobcopilot run sync-inbox | poll-boards | mark-stale | rescore | refine-requirements` runs one task immediately,
without the queue.

### Web console

```powershell
cd console; npm install
npm run build        # FastAPI then serves it at http://localhost:8000
npm run dev          # or: hot-reloading console on http://localhost:5173, proxying /api to :8000
```

Open the console and create an account with your email and password. The console uses an HTTP-only server-side session
cookie, so normal users do not need to know an API token. For local/admin compatibility, a configured
`JOBCOPILOT_API_TOKEN` is still accepted as a bearer token. Set `JOBCOPILOT_AUTH_COOKIE_SECURE=true` when serving over
HTTPS.

After changing API schemas: `backend\.venv\Scripts\jobcopilot openapi ..\shared\openapi.json`, then
`npm run gen:api` in `console/`. The extension uses the same `shared/api.d.ts`.

### Browser extension

```powershell
cd extension; npm install
npm run build        # unpacked extension in extension/dist
npm test             # adapter tests on fixtures (jsdom)
npx playwright install chromium; npm run e2e   # full loop in Chromium; needs a running API (E2E_API, E2E_TOKEN)
```

Load `extension/dist` at `chrome://extensions` (Developer mode → Load unpacked), open its options, and enter the
server address and access token. On a Greenhouse or Lever application page, click the toolbar icon, then **Fill**.
Review, complete what it flagged, and press Submit yourself.

The adapters and the end-to-end test run against hand-written fixtures modeled on Greenhouse and Lever pages
(`extension/test/fixtures`), not saved copies of live pages; check them against real forms before relying on them.
The end-to-end test writes jobs and applications to the API it points at, so point it at a scratch database.

Generation uses Ollama by default (`ollama pull llama3.1:8b`). Everything else works without a model.

### Custom LaTeX resume templates

The resume renderer uses fpdf2 by default. To use a custom LaTeX layout, copy or edit
`backend/templates/resume.tex`, install a LaTeX distribution such as MiKTeX or TeX Live, and set:

```powershell
JOBCOPILOT_LATEX_TEMPLATE=templates/resume.tex
JOBCOPILOT_LATEX_ENGINE=pdflatex
```

Templates use Jinja-style scalar placeholders. Values are escaped before insertion. The available
placeholders are `full_name`, `contact_line`, `email`, `phone`, `location`, `linkedin`, `github`,
`website`, `job_title`, `company`, `summary`, `highlights`, `experience`, `skills`, `education`, and
`certifications`. List placeholders such as `highlights` and `experience` contain ready-to-use
LaTeX `\item` lines, so the template controls the layout while approved content controls the data.

## Connecting Gmail (read-only)

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Gmail API**.
2. Configure the **OAuth consent screen**. On a Google Workspace domain choose **Internal**; on a personal
   Gmail account choose **External** and add yourself as a test user.
3. Create credentials → **OAuth client ID** → application type **Desktop app**, and download the JSON.
4. Put the file outside the repo and set `JOBCOPILOT_GMAIL_CLIENT_SECRET_FILE` to its path in `backend/.env`.
5. Run `.venv\Scripts\jobcopilot gmail-auth`. A browser window asks for read-only access; the refresh token
   is stored in Windows Credential Manager, not on disk.

Caveats: an External app left in "Testing" status gets refresh tokens that Google expires after 7 days, so
`gmail-auth` would need re-running weekly. The token lives in the OS keychain, so inbox sync works when the
worker runs on this machine, not inside a container (Azure will need Key Vault). `jobcopilot gmail-revoke`
forgets the token.

The first sync looks back 30 days (`JOBCOPILOT_GMAIL_INITIAL_LOOKBACK_DAYS`). Emails the worker cannot place
confidently show up at `GET /api/inbox`; assign them with `POST /api/inbox/{id}/assign`, import an application
made elsewhere with `POST /api/inbox/{id}/import` (`company`, `title`, optional `location`), or dismiss them.

The alert and confirmation formats were written from the general shape of LinkedIn and Naukri emails, not
checked against real ones. A card or email they cannot read fully is skipped, never guessed: an unreadable
alert from a known sender is recorded with action `alert_unparsed`, and an unreadable confirmation waits in
the inbox queue.

## Layout

```
backend/src/jobcopilot/
  profile/      facts, resume import, answer bank
  ingestion/    sources, adapters (greenhouse, lever), dedupe
  matching/     hard filters, extraction, mapping, scoring
  generation/   citation validator, prompts, document versions, approval, packet
  lifecycle/    state machine, transitions, evidence
  audit/        audit log, LLM call log, analytics
  llm/          provider interface, Ollama client, call logging and budget
  inbox/        Gmail client, classifier, email → application matcher, alert parser, off-system import, sync
  matching/extraction.py   model-based requirement extraction, grounded in the description
  generation/render.py     resume and answers-sheet PDFs
  worker.py     scheduled and queued tasks (Procrastinate)
  cli.py        `jobcopilot` command: worker, gmail-auth, run <task>
  api/          HTTP routes and schemas
backend/migrations/   Alembic (0002 append-only triggers, 0004 Procrastinate queue tables, 0005 retired requirements)
console/              web console (React, TypeScript, Vite)
extension/            Chrome extension (TypeScript, MV3): src/adapters per site, test/ fixtures, e2e/ Playwright
shared/               OpenAPI schema and the TypeScript types generated from it
```
