# User-uploaded panoramas: MVP progression

Build directly into Hunter Spatial, validating each phase before continuing.

This document records the design and progression of the user-submitted panorama
system. Phases 1–3 are implemented; Phases 4–5 are planned. See
[database/README.md](../database/README.md) for setup, endpoints, and demo credentials.

## Phase 1 — Panorama modal (implemented)

- Reuse panorama-test’s Pannellum viewer with the example image.
- Open it from room details in a modal supporting full and partial panoramas.
- Include a close button, Escape dismissal, focus management, and viewer cleanup.
- Preserve the map’s room selection, floor, and camera position.

**Checkpoint:** The example opens and closes correctly over the map.

## Phase 2 — Database and image storage (implemented)

### Storage layout

Keep persistent data at the project root, outside public assets:

```text
local-data/
├── app.sqlite
└── uploads/
    ├── <generated-id>.jpg
    └── <generated-id>.webp
```

Gitignore the entire directory. The database stores relative paths such as `uploads/abc123.webp`; the image bytes stay in the corresponding file.

### Table 1: `users`

Create this table now because panorama records reference uploaders and reviewers. Login functionality arrives in Phase 3.

| Column | SQLite type | Purpose |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | User identifier |
| `name` | TEXT NOT NULL | Display name |
| `email` | TEXT NOT NULL, UNIQUE, case-insensitive | Login email |
| `password_hash` | TEXT NOT NULL | Hashed password |
| `role` | TEXT NOT NULL | Restricted to `uploader` or `reviewer` |
| `created_at` | TEXT NOT NULL | UTC timestamp; defaults to current time |

### Table 2: `panoramas`

**One row represents one submitted image.** A location can have multiple submissions.

| Column | SQLite type | Purpose |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | Submission identifier |
| `location_id` | TEXT NOT NULL | Selected key from Hunter Spatial’s routing-graph room list |
| `file_path` | TEXT NOT NULL | Image path relative to `local-data/` |
| `uploaded_by` | INTEGER NOT NULL | Foreign key to `users.id` |
| `status` | TEXT NOT NULL | `pending`, `approved`, or `rejected`; defaults to `pending` |
| `haov` | REAL NOT NULL | Horizontal image coverage in degrees |
| `vaov` | REAL NOT NULL | Vertical image coverage in degrees |
| `v_offset` | REAL NOT NULL | Vertical offset in degrees; defaults to zero |
| `uploaded_at` | TEXT NOT NULL | UTC timestamp; defaults to current time |
| `reviewed_by` | INTEGER, nullable | Foreign key to reviewing user |
| `reviewed_at` | TEXT, nullable | UTC decision timestamp |

For example, a pending submission could contain:

```text
id:           12
location_id:  N304
file_path:    uploads/abc123.webp
uploaded_by:  1
status:       pending
haov:         360
vaov:         180
v_offset:     0
reviewed_by:  NULL
reviewed_at:  NULL
```

Approval updates that row’s status, reviewer, and review timestamp.

### Location association

Do not create a duplicate locations table. Keep the existing routing graph as the source of IDs, names, buildings, and floors.

The upload dropdown submits its selected key as `location_id`. Because that list lives outside SQLite, the backend must validate the key; it is not a database foreign key.

### Initialization and retrieval

- Adapt panorama-test’s schema and initialization script. Enable foreign keys on every database connection and use parameterized queries.
- Repeated initialization preserves existing records.
- Use `npm run db:seed` to create the demo reviewer and an approved example for N304, owned by that reviewer. Create the reviewer only if absent; do not reset its password on repeat setup.
- Add `GET /api/panoramas?locationId=…`, returning the latest approved image’s ID, browser image URL, and coverage settings—or `null`.
- Add `GET /api/panoramas/:id/image` to serve approved image bytes. Do not expose local filesystem paths.
- Select the displayed image with:

```sql
SELECT *
FROM panoramas
WHERE location_id = ? AND status = 'approved'
ORDER BY reviewed_at DESC, id DESC
LIMIT 1;
```

Earlier approvals remain stored. Pending and rejected submissions cannot displace them.

**Checkpoint:** The modal retrieves the seeded approved image from SQLite and backend image delivery. A location without approval shows an empty state, and data survives restarting the server.

## Phase 3 — Login and Upload tab (implemented)

- Add simple sign-up, sign-in, and sign-out. New accounts always receive the uploader role.
- Require the exact `@login.cuny.edu` domain for both account types, ignoring capitalization. Validate it on the frontend and backend. Check format only; do not claim to verify email ownership or authenticate through CUNY.
- Require a name of up to 50 characters, a unique email of up to 100 characters, and a password of 8–100 characters.
- Reserve `reviewer@login.cuny.edu` from public registration. Setup creates it with initial local-demo password `ReviewerDemo2026!` and role `reviewer`. Determine permissions from the stored role, using the same sign-in form for both roles. Report a conflict if that email belongs to an uploader. No legacy account conversion or migration support.
- Store passwords as one-way salted scrypt hashes using Node's built-in crypto module; never store plaintext or reversible passwords.
- Use a random opaque session cookie backed by SQLite sessions, with a 24-hour expiry and server-side invalidation on sign-out. Do not use JWT.
- The `sessions` table stores `token_hash` (SHA-256, primary key), `user_id` (foreign key), and `expires_at` (Unix seconds). Expired sessions cannot authenticate. Creating a session removes expired rows; there is no scheduled cleanup. Sign-out deletes the current row and clears the cookie. Separate browsers can have separate sessions; tabs in one profile normally share a cookie.
- Keep the sign-in/sign-up form, requests, and frontend email validation in `UserLogin.tsx`; keep final validation and authentication in `auth.ts`.
- Keep the MVP local: no SSO, email verification, password reset, or reviewer self-registration.
- Add a required searchable location dropdown using the existing room list. Show ID, name, building, and floor; require an actual selection.
- Validate the selected ID on the backend.
- Accept readable, non-animated JPEG, PNG, and WebP images up to 20 MB and 64 megapixels; preserve their format and generate unique filenames.
- Support full or partial viewing settings and preview before submission.
- Save pending records using the authenticated uploader. Clean up the image if database insertion fails.
- Add **My submissions** and restrict unpublished images to their uploader and reviewers.

**Checkpoint:** Users can submit persistent pending images associated with existing locations.

## Phase 4 — Reviewer approval (planned)

- Add a reviewer-only queue with location details and modal previews.
- Allow one approval or rejection per submission.
- Derive reviewer identity from the session and record decision time on the server.
- Update only pending submissions, recording `approved` or `rejected`, reviewer ID, and UTC review time. Require exactly one updated row so a decision cannot be repeated. No rejection explanation is collected in this MVP.
- Retain submission history and files.

**Checkpoint:** Approval publishes an image; rejection preserves the previous displayed image. Unauthorized or repeated decisions fail.

## Phase 5 — Complete map integration (planned)

- Replace hardcoded panorama lookups with approved-image data.
- Update room cards, 360° badges, and the panorama filter.
- Open approved images in the modal and remove temporary example integration.
- Add loading/error states and update documentation.

**Checkpoint:** Upload → review → view from map works without rebuilding the frontend.

## Verification and boundaries

Test persistence, foreign-key enforcement, location validation, latest-approved selection, file validation, permissions, and review decisions. Verify modal behavior and preserved map state. Finish with existing tests, a production build, and a mobile walkthrough.

Keep one local Next.js server, SQLite, separate image files, and simple local user accounts. Back up the database and uploads together with the server stopped. Defer SSO, email verification, password recovery, cloud hosting, stitching, optimization, realtime updates, schedules, and AI features. Keep setup focused on fresh installations without legacy conversion logic.
