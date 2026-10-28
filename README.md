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
npm test             # unit tests (vitest): schema, money, fiscal year, stipends, access, submit, sheet table, PDF builder, MIME, examples
npm run typecheck
npm run lint
npm run build
```

The same four checks run in GitHub Actions on every push and pull request; see `.github/workflows/ci.yml`.

## Configuration

Copy `.env.example` to `.env.local`. Everything has a development default except `SESSION_SECRET`, which is required in production (`openssl rand -base64 48`).

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Public base URL used in emailed links |
| `ADAPTERS` | `local` or `google` |
| `SESSION_SECRET` | Signs sign-in links and session cookies |
| `AP_EMAIL`, `FROM_EMAIL`, `FROM_NAME` | The AP team's address and who emails come from |
| `SEND_PACKETS_TO` | `requester` (default) emails the signed packet only to the person who signed it, to forward to `AP_EMAIL` by hand while the portal is being tried out; `ap` emails it to `AP_EMAIL` with a copy to the requester |
| `APPROVER_EMAIL` | Who approves new requester addresses (defaults to `AP_EMAIL`) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` | Service account credentials |
| `GOOGLE_IMPERSONATE_EMAIL` | Workspace user to act as (fs@) |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_NAME`, `GOOGLE_USERS_SHEET_NAME`, `GOOGLE_STIPENDS_SHEET_NAME` | Where data lives |
| `ALLOW_LOCAL_ADAPTERS_IN_PRODUCTION` | `1` only to try a production build on a laptop with `ADAPTERS=local`; otherwise a production build refuses to run without Google, since the local adapter would write to the serverless disk and lose everything |

## Phase 0: Google Workspace setup

One-time, done by the PTA's Google Workspace super admin and the fs@miralomasf.com account.

1. **Google Cloud project.** In [console.cloud.google.com](https://console.cloud.google.com) under the miralomasf.com organization, create a project (e.g. "PTA reimbursements"). Enable the **Google Drive API**, **Google Sheets API** and **Gmail API**.
2. **Service account.** IAM & Admin → Service Accounts → Create. No roles needed. Open it → Keys → Add key → JSON. Keep the file; it holds `client_email` and `private_key`. Note the numeric **Unique ID** (client ID).
3. **Domain-wide delegation.** In [admin.google.com](https://admin.google.com) → Security → Access and data control → API controls → Manage domain-wide delegation → Add new. Client ID: the service account's unique ID. Scopes, comma-separated:
   `https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/gmail.send`
4. **Drive and Sheet, as fs@.** Create a folder "PTA reimbursements" in fs@'s My Drive and note its ID (the last part of the folder URL). Create a Google Sheet "PTA reimbursement log" with tabs named `Requests`, `Users` and `Stipends`; the app writes each header row on first use, and adds columns it gained later to the end of an existing header row. Share both with the AP team. To spare teachers the approval wait, paste staff addresses into `Users` with `status` = `approved` with `role` = `teacher` and their `grade` (`TK`, `K`, `1`, …; for a combination class list several with commas, like `1, 2`, not `1/2`, which the Sheet turns into a date) for teachers, `role` = `ap` for AP team members, and the `stipend` amount for staff who have their own. In `Stipends`, the treasurer enters each fiscal year's amounts: one row `Classroom` (what each teacher gets), one `Field trip` (one fund for the whole school), and one per grade, `Grade TK`, `Grade K`, `Grade 1`, … (shared by that grade's teachers; TK is transitional kindergarten).

   To start from templates, import the CSVs in [`examples/google-sheet/`](examples/google-sheet/) into that one spreadsheet (uploading them to Drive on their own would make three separate spreadsheets): **File → Import → Upload**, choose `Users.csv`, and set *Import location* to **Insert new sheet(s)**. The new tab takes the file's name; make sure it reads exactly `Users`. Repeat for `Stipends.csv` and `Requests.csv` (headers only). Then replace the sample `example.org` people with real staff and enter the real stipend amounts.

   Every month or so, clear files older than 30 days out of `pending/`. They are receipts from drafts that were never signed, and can hold personal data; the app does not delete them yet.
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
  api/uploads/[id]       shows the signed-in user one of their own uploaded receipts
  api/requests/preview   builds the unsigned packet
  api/requests           signs, stores, logs and emails
src/server/adapters/     FileStore, RequestLog and Mailer interfaces
  local/                 filesystem versions for development
  google/                Drive, Sheets and Gmail as fs@ (service account + domain-wide delegation)
src/server/pdf/          fills the form template, lays out the expenditures, adds receipt and audit pages
src/lib/                 shared schema, money and date helpers
assets/form-template.pdf the official form with its fields renamed (see specs/)
```

Receipts never pass through the app server: the server opens an upload session (local: a dev-only PUT route; Google: a Drive resumable upload with the uploader recorded in `appProperties`), and the browser PUTs the bytes. HEIC photos are converted to JPEG in the browser before upload. At submit time the server re-checks that every receipt was uploaded by the signed-in user, builds the PDF with pdf-lib and sharp, hashes it, writes the row, and emails the PDF: to the requester alone, to forward to AP by hand (`SEND_PACKETS_TO=requester`, the default while the portal is being tried out), or to AP with a copy to the requester (`SEND_PACKETS_TO=ap`). A page view costs about four Sheets API reads and a submission about six plus the Drive calls; the Sheets quota is 300 requests a minute per project, far above a school's use, so nothing is cached and every read sees AP's latest edits.

## What the MVP decides for you

These follow the proposed defaults in the spec's *Open questions* and are easy to change:

- Request IDs are sequential per PTA fiscal year, e.g. `FY27-042`.
- The form draft lives in the browser's local storage, keyed by the signed-in address, until it is signed or discarded with the "Discard draft" link under the form. With no draft, the "about you" fields prefill from the requester's most recent request in the log.
- Signatures are typed or drawn fresh each time and never stored.
- "Locked" means: SHA-256 of the signed file recorded in the log and in the emails; the app never rewrites a packet.
- Sessions last 30 days, but every page and API call re-checks the Users tab, so denying or deleting a row locks that address out at once. Sign-in links last 15 minutes and work once.
- Each line of a request says which stipend pays for it. Teachers (`role` = `teacher` on their `Users` row) choose their classroom stipend, the shared stipend of each grade in their `grade` cell (none, one, or several for a combination class), the field-trip fund, or "Not from a stipend"; anyone else with a `stipend` amount chooses it or not; everyone else isn't asked. A new line takes the previous line's choice, and one receipt can be split between stipends by giving each share its own line with the same receipt attached. The approval page sets teacher or staff, the grade and the stipend; `ap` and `admin` are only set in the Sheet. The choice is stored as a readable label in the `funding` column of `Requests` ("Grade 2 stipend"); a request split between stipends lists each with its share of the claim ("Classroom stipend: 40.00; Grade 2 stipend: 50.00"), a donation coming off each share in proportion. AP may correct the cell by hand. What's left is worked out per PTA fiscal year from this year's requests (by request ID, leaving out returned ones), across all requesters for the shared grade and field-trip funds. Teachers see it on *My requests* and on the form, and both submission emails say where each stipend drawn on stands. Going over shows a warning, never a block; AP decides. A teacher's own `stipend` amount, if set, replaces the standard classroom amount.
- Who can sign in is the `Users` tab: approved addresses get links (one a minute, tracked on the row); unknown addresses are never emailed, the approver is, once, and at most 20 new pending addresses are recorded a day. The in-memory limiter (5 per address, 20 per IP every 15 minutes) sits in front as a first line.

## Not yet built

Phase 2 (AP dashboard, return with a note, mark paid, teacher notifications, weekly digest, CSV export) and Phase 3 (receipt OCR). The data model already carries the status, note, check number and category columns those need.
