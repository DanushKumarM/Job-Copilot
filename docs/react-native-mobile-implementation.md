# React Native Android Implementation Prompt

## Task

Implement an Android mobile application for this repository using React Native and Expo.

The Gemini coding agent reading this file must make the implementation directly in the repository. Do not only provide an implementation plan or sample code.

The mobile app is named **Job-Copilot**. It should be a native Android client for the existing Job-Copilot FastAPI backend. It is not a wrapper around the web console and it is not a redesign of the backend domain model.

## Repository context

- Repository: `DanushKumarM/Job-Copilot`
- Existing web console: `console/`
- FastAPI backend: `backend/src/jobcopilot/`
- Existing mobile concept/prototype: `docs/mobile_demo.html`
- Existing OpenAPI schema: `shared/openapi.json`
- Generated TypeScript API types: `shared/api.d.ts`
- API routes: `backend/src/jobcopilot/api/routes.py`
- Authentication: `backend/src/jobcopilot/auth.py`
- Authentication dependencies: `backend/src/jobcopilot/api/deps.py`
- Backend documentation: `README.md`

The backend is already implemented and tested. Preserve its lifecycle rules and evidence model. The mobile app must call the existing API rather than duplicating matching, scoring, generation, or lifecycle logic on-device.

## Required outcome

Create a working Expo/React Native Android app in a new repository directory named `mobile/`.

The app must support:

1. Sign in and registration
2. A polished mobile dashboard
3. Profile facts, resume import, verification, rejection, and revision
4. Job search, filtering, sorting, and adding a job
5. Job detail with score, requirements, fact matches, and evidence
6. Application pipeline with status stages
7. Application detail with claims, documents, approval, history, evidence, and PDF access
8. Inbox status and unresolved Gmail outcomes
9. Preferences, answer bank, sources, settings, and basic analytics
10. Android-safe loading, error, offline, retry, and session-expired states
11. A secure, persistent sign-in session
12. Android APK and development build instructions

The Chrome extension, Gmail OAuth setup, LLM setup, PostgreSQL setup, and LaTeX setup should not be moved into the mobile app. Expose only the backend features that are useful on Android.

## Approach

Use an Expo-managed React Native project with Expo Router for navigation.

Use:

- React Native
- TypeScript
- Expo
- Expo Router
- React Query/TanStack Query for server state
- Zustand only if local UI state becomes difficult to manage
- React Native StyleSheet for styling
- Expo SecureStore for secure session storage
- Expo Document Picker for resume uploads
- Expo FileSystem and Expo Sharing for downloaded PDFs
- Expo Haptics for meaningful native feedback
- `@expo/vector-icons` for icons

Do not use a WebView to reproduce the web console.

Do not copy HTML, CSS, `react-router-dom`, or DOM components into React Native.

Do reuse:

- API names and shapes from `shared/openapi.json`
- Generated API concepts from `shared/api.d.ts`
- Existing application and profile status values
- Existing scoring and evidence behavior
- Existing backend validation rules

## Backend authentication contract

The current API supports an opaque `jobcopilot_session` HTTP-only cookie and an optional static bearer token. React Native must not depend on the static admin API token.

Add a mobile-compatible bearer session flow while preserving all existing web and extension behavior.

For the implementation:

1. Keep `POST /api/auth/register` and `POST /api/auth/login` backward compatible.
2. Continue setting `jobcopilot_session` for browser clients.
3. Add an opaque `session_token` field to the authentication response for register/login.
4. Store that token only in Expo SecureStore on the mobile app.
5. Send `Authorization: Bearer <session_token>` on all mobile API requests.
6. Update `current_user()` so a user session bearer token is accepted safely.
7. Ensure static `JOBCOPILOT_API_TOKEN` behavior remains unchanged.
8. Add a mobile session token to `GET /api/auth/me`.
9. Have logout revoke the bearer/session token and remove it from SecureStore.
10. Do not add a separate password field or credentials to the mobile app's local database.

Regenerate `shared/openapi.json` and `shared/api.d.ts` after authentication schema changes.

If the agent considers cookie handling sufficient instead of this bearer flow, it must document and test it on Android. The bearer flow is preferred because it is deterministic across Android emulators and physical devices.

## API client

Create `mobile/src/api/client.ts` or an equivalent implementation.

It must:

- Read `EXPO_PUBLIC_API_URL`
- Send JSON with `Content-Type: application/json`
- Send the stored session bearer token
- Handle 401 responses consistently
- Parse FastAPI `detail` strings
- Parse FastAPI validation `detail` arrays
- Parse `{ issues: [...] }` validation failures
- Surface retryable network errors separately from API errors
- Use a bounded timeout
- Provide a TypeScript API surface for every supported endpoint
- Never trust or render an application status differently from the backend

Example API URL behavior:

- Android emulator: `http://10.0.2.2:8000`
- Physical Android device: `http://<development-machine-LAN-IP>:8000`
- HTTPS production: `https://<deployed-host>`

Do not use `localhost` for Android emulator access. Add a clear `.env.example` and startup instructions for Windows.

The backend currently has no CORS layer because the web console is same-origin. Native clients do not send browser CORS requests, but TLS/proxy deployment must remain configured carefully.

## Directory structure

Use a structure similar to:

```text
mobile/
  app/
    _layout.tsx
    (auth)/
      sign-in.tsx
      register.tsx
    (tabs)/
      _layout.tsx
      index.tsx
      jobs/
        index.tsx
        [id].tsx
      applications/
        index.tsx
        [id].tsx
      profile.tsx
      more.tsx
    inbox.tsx
    sources.tsx
    insights.tsx
    settings.tsx
    answers.tsx
  src/
    api/
    components/
    hooks/
    providers/
    theme/
    types/
    utils/
  assets/
  app.config.ts
  package.json
  .env.example
  README.md
```

The agent may adjust this structure if Expo Router conventions require it, but it must keep features modular and avoid a monolithic screen file.

## Navigation

Use native tab navigation with five primary destinations:

1. Home
2. Jobs
3. Pipeline
4. Inbox
5. More

Profile, Job Boards, Insights, Settings, and Answer Bank belong under More or their own stack destinations.

Use typed route params for job and application IDs.

Navigation requirements:

- Deep-link to `/jobs/:id` and `/applications/:id` should return the correct screen
- Native Android back behavior must work correctly
- Tabs must retain scroll position where practical
- The app must not reset the whole authenticated session on a normal refresh
- Sign-in and registration must be outside the tab stack

## Information architecture

### 1. Sign-in

Implement:

- Email
- Password
- Login
- Register mode
- Password minimum 8 characters
- Validation
- Keyboard-safe layout
- Loading state
- API error state
- Session restoration
- Logout

### 2. Home

Mirror the purpose of `console/src/pages/Home.tsx`:

- Verified fact count
- Proposed fact count
- Job count
- Active application count
- Applications needing review
- "Set up profile", "Find a job", or "Choose a job" next action
- A simple three-step flow:
  1. Verify profile
  2. Review job fit
  3. Prepare an application

Use the real API values. Do not fake counts or progress.

### 3. Profile

Implement the profile area with:

- Proposed, verified, rejected, and superseded facts
- Fact kind and statement
- Verification/rejection/revision actions
- Add fact
- Resume text paste/import
- Resume file upload
- Candidate answers
- Preferences

Important behavior:

- Verification is the only action that marks a fact usable for generated claims
- Revision creates/supersedes a fact, rather than silently overwriting it
- Rejected facts must remain visible and auditable
- Superseded facts must not be presented as current facts
- Every destructive or consequential action should require clear confirmation

### 4. Jobs

Implement:

- Search title, company, and location
- Segments for worth a look, applying, filtered out, and all
- Sort by best fit or recently seen
- Add job modal/sheet
- Job title
- Company
- Location
- Work mode
- Posting URL
- Full pasted description

Display:

- Fit score
- Company
- Location
- Work mode
- Freshness
- Application status
- Closed/stale indicators

When adding a job, call `POST /api/jobs`, then open the new job detail.

### 5. Job detail

Display:

- Score with evidence
- Job metadata
- Freshness
- Description
- Requirements
- Evidence/fact matches
- Evaluation
- Existing application status

Implement:

- Re-evaluate
- Extract/refine requirements
- Shortlist/create application
- Open an existing application

When the backend rejects or reports manual intervention, show the exact API detail/issues. Do not replace it with invented explanations.

### 6. Pipeline

Implement a native Kanban-style list, not a horizontal web board that requires awkward pinch/scroll.

The stages must map to existing statuses:

| Mobile stage | Existing statuses |
|---|---|
| Needs attention | `needs_manual_intervention`, `failed` |
| To prepare | `shortlisted`, `prepared` |
| To review | `awaiting_approval` |
| Ready to apply | `approved`, `submission_in_progress` |
| Submitted | `submitted_unconfirmed`, `submission_confirmed` |
| In process | `assessment`, `interview` |
| Closed | `offer`, `rejected`, `withdrawn` |

Implement:

- Section headers and counts
- Optional closed stages
- Empty states
- Native cards
- Relative updated time
- Pull-to-refresh
- Open application detail

### 7. Application detail

Display:

- Job title and company
- Status
- Fit score
- Lock version
- Documents
- Claim drafts
- Citation/fact references
- Allowed next transitions
- Evidence
- Append-only history

Implement:

- Generate resume bullets
- Generate summary
- Generate screening answers
- Generate cover letter
- Edit/save claims
- Approve with lock version
- Perform allowed transitions
- Open/download resume PDF
- Open/download answers PDF

Do not let a claim edit or status transition silently bypass optimistic locking or backend validation.

Generation and approval behavior must retain:

- Verified-fact-only claims
- Citation IDs
- Validator issue display
- Manual intervention states

### 8. Inbox

Implement:

- Inbox status: Gmail connected, last sync, unresolved count
- Sync inbox
- List unresolved inbound messages
- Classification and confidence
- Extracted company/title/application data
- Assign to application
- Import as off-system application
- Dismiss

Gmail remains server-side. The mobile app must not request Gmail credentials or connect to Gmail directly.

### 9. Sources and Insights

Sources:

- List sources
- Add Greenhouse or Lever source
- Poll source
- Show source errors clearly

Insights:

- Funnel by status
- Funnel by source
- Submitted unconfirmed count
- LLM call count
- Cost and token count

Do not expose API keys or worker secrets.

### 10. Settings

Include:

- Server/API URL display
- Backend health status
- Account email
- Logout
- About/app version
- Optional retry worker/action status, only if the backend exposes it

## Design system

Use the visual direction of `docs/mobile_demo.html` while preserving the Job-Copilot content model.

Create a consistent theme:

### Colors

- Background: `#090D16`
- Surface: `#141B2D`
- Surface raised: `#1E2942`
- Border: `#222F4C`
- Text: `#F3F4F6`
- Muted text: `#94A3B8`
- Primary: `#3B82F6`
- Success: `#10B981`
- Warning: `#F59E0B`
- Danger: `#EF4444`

Support a light theme as well. Use system theme by default, with an optional manual setting. Do not make text or icons low contrast in dark mode.

### Typography

- Use a clean native sans-serif
- Optional bundled Plus Jakarta Sans font
- Display title 28-32 dp
- Screen title 22-24 dp
- Card title 16-18 dp
- Body 14-16 dp
- Caption 12-13 dp
- Tab label 11-12 dp

### Component rules

- Minimum tap target: 44 dp, preferably 48 dp
- Card radius: 12-16 dp
- Primary button radius: 10-12 dp
- Button height: 48 dp
- Use 8 dp grid spacing
- Use consistent 16 dp horizontal page padding
- Bottom safe-area and status-bar awareness
- Avoid text below 12 dp
- Use no rounded pill for every label
- Use badges sparingly for status/freshness
- Use bottom sheets rather than desktop-style modals
- Use native lists/FlashList when they improve performance
- Use skeletons and subtle shimmer; do not block the whole page
- Use haptics for verify, approve, and submit-related confirmations
- Respect reduced motion

### Navigation affordances

- Active tab in primary blue
- Clear selected state
- Android system back behavior
- Header title and back button
- Avoid hamburger navigation on Android unless a real secondary hierarchy requires it

## Screen states

Every network-backed screen must handle:

- Loading
- Empty
- Refreshing
- API error
- Network/offline error
- 401 session expired
- 403/permission
- 404 missing record
- 422 validation and issues
- Retry
- Optimistic-lock conflict

Use one shared error component and one shared loading/skeleton component.

Use `Alert` or native bottom sheets for destructive confirmations. Do not crash or leave a screen in a permanently busy state.

## Offline and persistence

The mobile app may cache server data for:

- Recent jobs
- Recent applications
- Profile facts
- Dashboard summaries

Use React Query persistence only if the selected library supports it safely. Do not treat cache as authoritative.

Do not silently queue lifecycle changes while offline. Status transitions and approval require server validation and the current lock version.

## Data and security

- Store session bearer tokens in SecureStore
- Never store passwords or API keys
- Never log Authorization headers
- Never log resume text or claim content
- Enforce HTTPS for production API URLs
- Show a warning when using cleartext HTTP
- Clear session state on logout
- Do not request unnecessary Android permissions
- Do not collect analytics without an explicit privacy feature
- Add certificate/TLS validation normally; do not disable it

## API implementation details

Create typed models using `shared/api.d.ts` or generate equivalent types from `shared/openapi.json`.

Do not hand-maintain duplicate API contracts unless there is a build-time reason. Provide a script to refresh generated types if needed.

Implement at least these calls:

```text
Auth
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me

Profile
GET  /api/profile/facts
POST /api/profile/resume
POST /api/profile/resume/upload
POST /api/profile/facts
POST /api/profile/facts/{id}/verify
POST /api/profile/facts/{id}/reject
POST /api/profile/facts/{id}/revise
GET  /api/profile/preferences
PUT  /api/profile/preferences
GET  /api/profile/answers
PUT  /api/profile/answers/{key}

Jobs
GET  /api/jobs
POST /api/jobs
GET  /api/jobs/{id}
POST /api/jobs/{id}/evaluate
POST /api/jobs/{id}/extract
POST /api/jobs/{id}/application
GET  /api/sources
POST /api/sources
POST /api/sources/{id}/poll

Applications
GET  /api/applications
GET  /api/applications/{id}
POST /api/applications/{id}/generate
PUT  /api/applications/{id}/documents/{kind}
POST /api/applications/{id}/approve
POST /api/applications/{id}/transition
GET  /api/applications/{id}/resume.pdf
GET  /api/applications/{id}/answers.pdf
GET  /api/queue
GET  /api/analytics/funnel

Inbox
GET  /api/inbox/status
POST /api/inbox/sync
GET  /api/inbox
POST /api/inbox/{id}/assign
POST /api/inbox/{id}/import
POST /api/inbox/{id}/dismiss
```

Refresh API query caches after mutations. Treat list/detail data as server state.

## Backend changes required

The implementation may change backend code only for:

- Mobile bearer session authentication
- Mobile-compatible authentication response fields
- CORS or HTTPS deployment settings, if absolutely necessary
- Correct OpenAPI/type generation
- Any bug discovered by real Android integration testing

Do not rewrite FastAPI domain services for React Native.

Do not expose secret environment values in the app or logs.

## Android setup

Add root or mobile scripts/documentation for:

```powershell
cd mobile
npm install
npx expo start
npx expo run:android
```

Provide instructions for:

- Android Studio
- Android SDK
- Java required by Expo/React Native
- Android emulator
- Physical-device USB setup
- Physical-device LAN backend access
- Backend running on port `8000`
- Production release build with EAS or local Gradle

Create an APK build path:

```powershell
cd mobile
npx expo prebuild
npx expo run:android --variant release
```

Prefer EAS Build for a standard release workflow if configured.

Do not commit signing keys or Gradle secrets.

## Testing

Run the smallest relevant test commands after each meaningful implementation phase.

Required mobile checks:

- TypeScript typecheck
- Expo config validation
- Android unit tests for pure API/error helpers
- API client tests for 401 and validation responses
- Navigation smoke tests
- One Android emulator flow for:
  - Register/login
  - Session restoration
  - Logout
  - Add and view a job
  - Verify a profile fact
  - Open pipeline
- PDF file download/share on Android
- Resume upload on Android
- 422 and 409/lock-version error handling
- Pull-to-refresh and 401 behavior

Keep tests in `mobile/test/` or a convention consistent with the selected test runner.

Backend tests must continue passing after authentication changes. Run:

```powershell
cd backend
.venv\Scripts\pytest
```

## Acceptance criteria

The task is complete when:

1. `mobile/` is a real Expo/React Native app, not a web app clone.
2. The app builds and runs on Android.
3. Sign-in works against the local FastAPI backend.
4. Session restoration survives app restart.
5. The app can add and view jobs.
6. The app can verify profile facts.
7. The app can view the application pipeline and application detail.
8. The app can generate, edit, save, and approve documents.
9. PDF and resume actions work on Android.
10. Inbox and sources use real backend endpoints.
11. Loading, empty, offline, 401, 422, and optimistic-lock states are implemented.
12. The backend OpenAPI schema and generated API types remain synchronized.
13. Existing web console and backend tests are not broken.
14. `mobile/README.md` contains setup, environment, emulator, and release instructions.

## Implementation sequence

Complete the work in this order:

1. Inspect and build the baseline backend and web console.
2. Add mobile bearer session authentication and regenerate API types.
3. Create the Expo app and theme foundations.
4. Implement API client, secure session storage, and auth navigation.
5. Implement Home, Jobs, Job detail, and Profile.
6. Implement Pipeline and Application detail.
7. Implement Inbox, Sources, Insights, Settings, and Preferences.
8. Add PDF, resume upload, cache, retry, and accessibility behavior.
9. Add Android tests and run the full targeted validation suite.
10. Update repository documentation and report exact files changed.

Do not stop after the project scaffold or after static screens. Deliver working API-backed flows.

## Do not implement

- A duplicate backend in JavaScript or Python
- Direct database access from React Native
- Direct Gmail OAuth inside the app
- Direct LLM/provider calls inside the app
- Replacing the FastAPI lifecycle engine
- Silent claim generation without citations
- Status changes without backend evidence
- A browser iframe or WebView clone of the console
- Any fake mobile-only data in production UI
