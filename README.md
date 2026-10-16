# Miraloma PTA reimbursement portal

A small Next.js app where a teacher photographs receipts, fills in the PTA's *Payment Authorization / Request for Reimbursement* form, signs it on the phone, and the signed packet (form + receipts + audit page) is emailed to ap@miralomasf.com and logged. The product spec and the form template live in [`specs/`](specs/).

The app keeps no data of its own. In production everything goes to the PTA's Google Workspace as fs@miralomasf.com: receipts and packets in a Drive folder, one row per request in a Sheet, email through Gmail. In development the same code writes to `./.data` instead.

## Run it locally

```bash
npm install
npm run dev          # http://localhost:3000
```

No Google setup is needed for development. With the default `ADAPTERS=local`:

- Sign-in emails are printed to the terminal and saved to `.data/outbox/`. Copy the link from there.
- Receipts and signed PDFs are saved under `.data/files/`.
- The request log is `.data/requests.json`; the users and stipend amounts are `.data/users.json` and `.data/stipends.json`, with the same columns as the Users and Stipends tabs.
- Submission emails, with the PDF attached, land in `.data/outbox/`.

To start with sample people and stipend amounts, copy the examples in (`-n` keeps any file you already have):

```bash
mkdir -p .data && cp -n examples/local-data/*.json .data/
```

Then sign in as one of them, e.g. `grade2.teacher@example.org` (a grade 2 teacher) or `librarian@example.org` (staff with a stipend). Each row's `note` says what that person is asked. A unit test keeps the examples in step with the data model.

Other commands:

```bash
npm test             # unit tests (vitest): schema, money, fiscal year, stipends, PDF builder, MIME, examples
npm run typecheck
npm run lint
npm run build
```

## Configuration

Copy `.env.example` to `.env.local`. Everything has a development default except `SESSION_SECRET`, which is required in production (`openssl rand -base64 48`).

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Public base URL used in emailed links |
| `ADAPTERS` | `local` or `google` |
| `SESSION_SECRET` | Signs sign-in links and session cookies |
| `AP_EMAIL`, `FROM_EMAIL`, `FROM_NAME` | Where packets go and who they come from |
| `APPROVER_EMAIL` | Who approves new requester addresses (defaults to `AP_EMAIL`) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` | Service account credentials |
| `GOOGLE_IMPERSONATE_EMAIL` | Workspace user to act as (fs@) |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_NAME`, `GOOGLE_USERS_SHEET_NAME`, `GOOGLE_STIPENDS_SHEET_NAME` | Where data lives |

## Phase 0: Google Workspace setup

One-time, done by the PTA's Google Workspace super admin and the fs@miralomasf.com account.

1. **Google Cloud project.** In [console.cloud.google.com](https://console.cloud.google.com) under the miralomasf.com organization, create a project (e.g. "PTA reimbursements"). Enable the **Google Drive API**, **Google Sheets API** and **Gmail API**.
2. **Service account.** IAM & Admin → Service Accounts → Create. No roles needed. Open it → Keys → Add key → JSON. Keep the file; it holds `client_email` and `private_key`. Note the numeric **Unique ID** (client ID).
3. **Domain-wide delegation.** In [admin.google.com](https://admin.google.com) → Security → Access and data control → API controls → Manage domain-wide delegation → Add new. Client ID: the service account's unique ID. Scopes, comma-separated:
   `https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/gmail.send`
4. **Drive and Sheet, as fs@.** Create a folder "PTA reimbursements" in fs@'s My Drive and note its ID (the last part of the folder URL). Create a Google Sheet "PTA reimbursement log" with tabs named `Requests`, `Users` and `Stipends`; the app writes each header row on first use, and adds columns it gained later to the end of an existing header row. Share both with the AP team. To spare teachers the approval wait, paste staff addresses into `Users` with `status` = `approved` with `role` = `teacher` and their `grade` (`TK`, `K`, `1`, …; for a combination class list several with commas, like `1, 2`, not `1/2`, which the Sheet turns into a date) for teachers, `role` = `ap` for AP team members, and the `stipend` amount for staff who have their own. In `Stipends`, the treasurer enters each fiscal year's amounts: one row `Classroom` (what each teacher gets), one `Field trip` (one fund for the whole school), and one per grade, `Grade TK`, `Grade K`, `Grade 1`, … (shared by that grade's teachers; TK is transitional kindergarten).

   To start from templates, import the CSVs in [`examples/google-sheet/`](examples/google-sheet/) into that one spreadsheet (uploading them to Drive on their own would make three separate spreadsheets): **File → Import → Upload**, choose `Users.csv`, and set *Import location* to **Insert new sheet(s)**. The new tab takes the file's name; make sure it reads exactly `Users`. Repeat for `Stipends.csv` and `Requests.csv` (headers only). Then replace the sample `example.org` people with real staff and enter the real stipend amounts.
5. **Vercel.** Create the Vercel account under fs@miralomasf.com, import the GitHub repo, set the environment variables above with `ADAPTERS=google`, and add the custom domain.

The app never stores the key on disk; it reads `GOOGLE_PRIVATE_KEY` from the environment. In Vercel, paste the key with its `\n` line breaks intact.

## How it works

```
src/app/                 pages and route handlers
  page.tsx               sign-in (email a one-time link)
  auth/callback          link lands here; a click completes sign-in (so email scanners can't use it up)
  auth/pending           shown to a first-time address while the PTA approves it
  auth/approve           the approver's page from the approval email: Approve / Deny
  requests/new           the form: details, one line per receipt, preview, sign
  requests/[id]          status and the signed PDF
  api/auth/request-link  approved address: sends a link; unknown address: asks the approver
  api/auth/approve       applies the approver's decision
  api/uploads            opens a direct upload for one receipt
  api/requests/preview   builds the unsigned packet
  api/requests           signs, stores, logs and emails
src/server/adapters/     FileStore, RequestLog and Mailer interfaces
  local/                 filesystem versions for development
  google/                Drive, Sheets and Gmail as fs@ (service account + domain-wide delegation)
src/server/pdf/          fills the form template, adds schedule, receipt and audit pages
src/lib/                 shared schema, money and date helpers
assets/form-template.pdf the official form with its fields renamed (see specs/)
```

Receipts never pass through the app server: the server opens an upload session (local: a dev-only PUT route; Google: a Drive resumable upload with the uploader recorded in `appProperties`), and the browser PUTs the bytes. HEIC photos are converted to JPEG in the browser before upload. At submit time the server re-checks that every receipt was uploaded by the signed-in user, builds the PDF with pdf-lib and sharp, hashes it, writes the row, and emails AP and the requester with the PDF attached.

## What the MVP decides for you

These follow the proposed defaults in the spec's *Open questions* and are easy to change:

- Request IDs are sequential per PTA fiscal year, e.g. `FY27-042`.
- The form draft lives in the browser's local storage until it is signed. With no draft, the "about you" fields prefill from the requester's most recent request in the log.
- Signatures are typed or drawn fresh each time and never stored.
- "Locked" means: SHA-256 of the signed file recorded in the log and in the emails; the app never rewrites a packet.
- Sessions last 30 days; sign-in links last 15 minutes.
- Each request says which stipend pays for it. Teachers (`role` = `teacher` on their `Users` row) choose their classroom stipend, the shared stipend of each grade in their `grade` cell (none, one, or several for a combination class), the field-trip fund, or "Not from a stipend"; anyone else with a `stipend` amount chooses it or not; everyone else isn't asked. The approval page sets teacher or staff, the grade and the stipend; `ap` and `admin` are only set in the Sheet. The choice is stored as a readable label in the `funding` column of `Requests`, which AP may correct by hand. What's left is worked out per PTA fiscal year from this year's requests (by request ID, leaving out returned ones), across all requesters for the shared grade and field-trip funds. Teachers see it on *My requests* and on the form, and both submission emails say where the chosen stipend stands. Going over shows a warning, never a block; AP decides. A teacher's own `stipend` amount, if set, replaces the standard classroom amount.
- Who can sign in is the `Users` tab: approved addresses get links (one a minute, tracked on the row); unknown addresses are never emailed, the approver is, once, and at most 20 new pending addresses are recorded a day. The in-memory limiter (5 per address, 20 per IP every 15 minutes) sits in front as a first line.

## Not yet built

Phase 2 (AP dashboard, return with a note, mark paid, teacher notifications, weekly digest, CSV export) and Phase 3 (receipt OCR). The data model already carries the status, note, check number and category columns those need.
