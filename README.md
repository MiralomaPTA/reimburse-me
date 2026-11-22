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
- The request log is `.data/requests.json`; the users, stipend amounts, events and budget categories are `.data/users.json`, `.data/stipends.json`, `.data/events.json` and `.data/categories.json`, with the same columns as the Users, Stipends, Events and Categories tabs. What AP does in the dashboard is recorded in `.data/actions.json`.
- Submission emails, with the PDF attached, land in `.data/outbox/`, and so do the emails asking an event chair or a check signer to sign. Open the link in one of those to act as the chair or the signer.

To start with sample people and stipend amounts, copy the examples in (`-n` keeps any file you already have):

```bash
mkdir -p .data && cp -n examples/local-data/*.json .data/
```

Then sign in as one of them, e.g. `grade2.teacher@example.org` (a grade 2 teacher) or `librarian@example.org` (staff with a stipend), or as `treasurer@example.org` (AP) to see every request on the AP dashboard at `/ap`. Each row's `note` says what that person is asked. To try the event chair step, write "Fun Run" or "Fall Festival" in a request's description: the chairs in `events.json` aren't users, so their signing links are only in `.data/outbox/`. To try a mailed check, set `CHECK_SIGNERS` to three made-up addresses and `BILL_PAY_ACCOUNTS` to a nickname, then sign in as `librarian@example.org`, whose `mailed_checks` is `yes`; the check signers' links are in `.data/outbox/` too. A unit test keeps the examples in step with the data model. To try AP's steps on your own request, sign in as `admin@example.org` instead: nobody can act on their own request.

Other commands:

```bash
npm test             # unit tests (vitest): schema, money, fiscal year, stipends, access, submit, chair, check signers, AP dashboard and steps, sheet table, PDF builder, MIME, examples
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
| `CHECK_SIGNERS` | The PTA's check signers' own addresses, separated by commas. Any two of them sign a mailed check's FO10. Not a shared alias, and none of `AP_EMAIL`, `APPROVER_EMAIL` or `FROM_EMAIL`: the app refuses to start with one of those, an entry that isn't an address, or the same address twice. Removing an address and redeploying stops its links at once. Keep it matching the board's check signers, usually each fiscal year |
| `BILL_PAY_ACCOUNTS` | The PTA accounts bill pay can draw from, separated by commas, by nickname or last four digits ("Bill pay checking ••1234"), never a full account number (the app refuses more than four digits in a row). The first is the default for the FO10's Payment Account. Mailing is offered only when this and `CHECK_SIGNERS` are both set |
| `MAILED_CHECKS` | `pilot` (the default): "Mail it to me" is offered only to accounts whose `mailed_checks` cell in the Users tab is `yes`. `everyone`: offered to every account not set to `no`, and the teacher and volunteer guides describe it. `off`: offered to nobody, whatever the cells say; requests already with the check signers carry on |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` | Service account credentials |
| `GOOGLE_IMPERSONATE_EMAIL` | Workspace user to act as (fs@) |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_NAME`, `GOOGLE_USERS_SHEET_NAME`, `GOOGLE_STIPENDS_SHEET_NAME`, `GOOGLE_EVENTS_SHEET_NAME`, `GOOGLE_SIGNATURES_SHEET_NAME`, `GOOGLE_CATEGORIES_SHEET_NAME`, `GOOGLE_ACTIONS_SHEET_NAME` | Where data lives |
| `ALLOW_LOCAL_ADAPTERS_IN_PRODUCTION` | `1` only to try a production build on a laptop with `ADAPTERS=local`; otherwise a production build refuses to run without Google, since the local adapter would write to the serverless disk and lose everything |

## Phase 0: Google Workspace setup

One-time, done by the PTA's Google Workspace super admin and the fs@miralomasf.com account.

1. **Google Cloud project.** In [console.cloud.google.com](https://console.cloud.google.com) under the miralomasf.com organization, create a project (e.g. "PTA reimbursements"). Enable the **Google Drive API**, **Google Sheets API** and **Gmail API**.
2. **Service account.** IAM & Admin → Service Accounts → Create. No roles needed. Open it → Keys → Add key → JSON. Keep the file; it holds `client_email` and `private_key`. Note the numeric **Unique ID** (client ID).
3. **Domain-wide delegation.** In [admin.google.com](https://admin.google.com) → Security → Access and data control → API controls → Manage domain-wide delegation → Add new. Client ID: the service account's unique ID. Scopes, comma-separated:
   `https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/gmail.send`
4. **Drive and Sheet, as fs@.** Create a folder "PTA reimbursements" in fs@'s My Drive and note its ID (the last part of the folder URL). Create a Google Sheet "PTA reimbursement log" with tabs named `Requests`, `Users`, `Stipends`, `Events` and `Categories`; the app writes each header row on first use, creates a tab that is missing (like `Signatures` and `Actions`, which only the app writes), and adds columns it gained later to the end of an existing header row. Share both with the AP team. To spare teachers the approval wait, paste staff addresses into `Users` with `status` = `approved` with `role` = `teacher` and their `grade` (`TK`, `K`, `1`, …; for a combination class list several with commas, like `1, 2`, not `1/2`, which the Sheet turns into a date) for teachers, `role` = `ap` for AP team members, and the `stipend` amount for staff who have their own. In `Stipends`, the treasurer enters each fiscal year's amounts: one row `Classroom` (what each teacher gets), one `Field trip` (one fund for the whole school), and one per grade, `Grade TK`, `Grade K`, `Grade 1`, … (shared by that grade's teachers; TK is transitional kindergarten). In `Events`, the admin lists each PTA event with a chair: its `name` as requesters should see it, the chair's `chair_email` (several, comma-separated, for co-chairs), optional `aliases` that help the form recognize it in a description, an optional `budget` for the year, and `active` (`no` hides it). Chairs don't need a `Users` row. Leave the tab empty and the form never asks about events. In `Categories`, the treasurer lists the budget categories AP gives requests on the dashboard: a `name`, `active` (`no` takes it out of the dropdown but leaves it on the requests that have it) and an `order` for the dropdown. Until it has rows, the dropdown offers only "Uncategorized".

   To start from templates, import the CSVs in [`examples/google-sheet/`](examples/google-sheet/) into that one spreadsheet (uploading them to Drive on their own would make separate spreadsheets): **File → Import → Upload**, choose `Users.csv`, and set *Import location* to **Insert new sheet(s)**. The new tab takes the file's name; make sure it reads exactly `Users`. Repeat for `Stipends.csv`, `Events.csv`, `Categories.csv` and `Requests.csv` (headers only). Then replace the sample `example.org` people and chairs with real ones and enter the real stipend amounts and event budgets.

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
  requests/[id]          status, the signed (or co-signed) PDF, and "Resend to the chair"
  chair/[id]             an event chair's page from their emailed link: the request, the event budget, Sign
  ap                     the AP dashboard: every request with its age, filters, and Export CSV (role ap or admin)
  ap/[id]                one request for AP: every detail, its packets and earlier versions, its history, its budget category,
                         and the next step: Approve, Return with a note, Record check (or bill pay), Mark sent
  ap/export              the CSV of what the dashboard's filters show
  help, help/teachers, help/volunteers, help/chairs
                         step-by-step guides with screenshots (see below)
  api/auth/request-link  approved address: sends a link; unknown address: asks the approver
  api/auth/approve       applies the approver's decision
  api/uploads            opens a direct upload for one receipt
  api/uploads/[id]       shows the signed-in user one of their own uploaded receipts
  api/requests/preview   builds the unsigned packet
  api/requests           signs, stores, logs, and emails the event chair or AP
  api/requests/[id]/resend-chair
                         the requester's "Resend to the chair"
  api/chair/sign         the chair's signature: stamps a co-signed copy and sends it on
  api/ap/[id]/category   AP's Save on the category dropdown
src/server/adapters/     FileStore, RequestLog and Mailer interfaces
  local/                 filesystem versions for development
  google/                Drive, Sheets and Gmail as fs@ (service account + domain-wide delegation)
src/server/pdf/          fills the form template, lays out the expenditures, adds receipt and audit pages
src/lib/                 shared schema, money and date helpers
assets/form-template.pdf the official form with its fields renamed (see specs/)
```

Receipts never pass through the app server: the server opens an upload session (local: a dev-only PUT route; Google: a Drive resumable upload with the uploader recorded in `appProperties`), and the browser PUTs the bytes. HEIC photos are converted to JPEG in the browser before upload. At submit time the server re-checks that every receipt was uploaded by the signed-in user, builds the PDF with pdf-lib and sharp, hashes it, writes the row, and emails the PDF: to the requester alone, to forward to AP by hand (`SEND_PACKETS_TO=requester`, the default while the portal is being tried out), or to AP with a copy to the requester (`SEND_PACKETS_TO=ap`). A page view costs about four Sheets API reads and a submission about six plus the Drive calls; the Sheets quota is 300 requests a minute per project, far above a school's use, so nothing is cached and every read sees AP's latest edits.

## Help pages

`/help` links to two step-by-step guides, `/help/teachers` and `/help/volunteers`, reachable from the sign-in page, the header and the footer. They are ordinary pages in `src/app/help/`, so their wording follows the configuration: the AP address, how long sign-in links last, and whether the signed packet goes to AP or is forwarded by the requester (`SEND_PACKETS_TO`).

The screenshots in `src/images/help/` are taken from the app itself. After a change to the form or to any page they show, regenerate them:

```bash
npx playwright install chromium   # once
npm run help:screenshots
```

The script starts `next dev` on port 3100 with the local adapters and a throwaway data folder (`.data/help-screenshots`, seeded from `examples/local-data`), submits a request as the sample volunteer and the sample teacher on a phone-sized headless Chromium, and captures the done and request pages in both `SEND_PACKETS_TO` modes so each guide can show the one in use. The preview PDF on the "Check and sign" page is rendered with Quick Look on macOS or `pdftoppm` (poppler) elsewhere; without either, that one screenshot shows an empty frame. Commit the new images with the change that made them necessary.

## What the MVP decides for you

These follow the proposed defaults in the spec's *Open questions* and are easy to change:

- Request IDs are sequential per PTA fiscal year, e.g. `FY27-042`.
- The form draft lives in the browser's local storage, keyed by the signed-in address, until it is signed or discarded with the "Discard draft" link under the form. With no draft, the "about you" fields prefill from the requester's most recent request in the log.
- Signatures are typed or drawn fresh each time and never stored.
- "Locked" means: SHA-256 of the signed file recorded in the log and in the emails; the app never rewrites a packet.
- Sessions last 30 days, but every page and API call re-checks the Users tab, so denying or deleting a row locks that address out at once. Sign-in links last 15 minutes and work once.
- Each line of a request says which stipend pays for it. Teachers (`role` = `teacher` on their `Users` row) choose their classroom stipend, the shared stipend of each grade in their `grade` cell (none, one, or several for a combination class), the field-trip fund, or "Not from a stipend"; anyone else with a `stipend` amount chooses it or not; everyone else isn't asked. A new line takes the previous line's choice, and one receipt can be split between stipends by giving each share its own line with the same receipt attached. The approval page sets teacher or staff, the grade and the stipend; `ap` and `admin` are only set in the Sheet. The choice is stored as a readable label in the `funding` column of `Requests` ("Grade 2 stipend"); a request split between stipends lists each with its share of the claim ("Classroom stipend: 40.00; Grade 2 stipend: 50.00"), a donation coming off each share in proportion. AP may correct the cell by hand. What's left is worked out per PTA fiscal year from this year's requests (by request ID, leaving out returned ones), across all requesters for the shared grade and field-trip funds. Teachers see it on *My requests* and on the form, and both submission emails say where each stipend drawn on stands. Going over shows a warning, never a block; AP decides. A teacher's own `stipend` amount, if set, replaces the standard classroom amount.
- A request for a PTA event (picked on the form, which guesses it from the description) goes first to the chairs listed for that event in the `Events` tab, each with their own link that works for 14 days, for that one request. Any one chair signs the form's VP/Chairman line; the app stamps the signature on a copy of the packet (`FY27-042-cosigned.pdf`, beside the original, which is never changed), adds a countersignature page, and sends the copy on the way `SEND_PACKETS_TO` says. Until then the request is "Awaiting chair" and AP gets nothing. A requester who chairs the event, or an event with no chair, skips the step. With a `budget` on the event, the chair sees what's left before and after the request, counted like the stipends; going over is a warning, never a block. The requester can resend the chair email once a day. There are no reminders or time-out: if a chair can't sign, the admin changes the event's chairs and the requester sends it to the new one at once. A chair who finds a problem sends the request back with a note instead of signing; it becomes "Returned", the chair links stop working, and the requester is emailed the note with a link to fix it. Every request's content is also saved as `FY27-042.json` beside its PDF.
- A returned request, whoever sent it back (its event chair, a check signer, or AP setting `status` to `Returned` with a `returned_note` in the Sheet), has a **Fix and re-sign** button on its request page. The form opens filled in from the request's JSON as it was signed, receipts included (they stay in the request's folder and may be used again by that request only), and the requester changes anything and signs again. That makes the next version under the same ID: `FY27-042-v2.pdf` and `FY27-042-v2.json` beside the earlier files, which are never changed or deleted; the row's `version` goes up, `pdf_file_id` points at the new packet and `previous_pdf_file_ids` lists the earlier ones. The new version takes the same path as a new request, so every version goes back to the event's chairs and a mailed check needs two check signers again; every later step's columns start blank, and links from earlier versions stop working. The emails and the chair and signer pages say which version it is and the note it answers, and the packet prints its version. `returned_at`, `returned_by` and `returned_note` record the last return.
- A mailed check goes through the bank's bill pay, which CAPTA treats as an electronic payment: it needs an FO10 (*Authorization for Payment via Electronic Services*) signed by two check signers. "Mail it to me" is switched on account by account (the Users tab's `mailed_checks` column, and `MAILED_CHECKS`), and asks for a street address and a city, state and ZIP, one plain line of up to 40 characters each, remembered from the requester's last mailed request. The address goes on the FO10, never the reimbursement form, so the event chair doesn't see it. Once the requester (and the chair, for an event) have signed, the request is "Awaiting signers" and every address in `CHECK_SIGNERS` but the requester's gets its own link, good for 14 days. The first to sign confirms the Budget Account (filled in from the stipend or event) and picks the Payment Account from `BILL_PAY_ACCOUNTS`; both are then locked, and the app saves the FO10 with that signature as `FY27-042-fo10-1.pdf`. A second, different signer signs the other line, and the app builds `FY27-042-authorized.pdf` (the signed FO10, every page of the packet they authorized, and an authorization page) and emails it straight to AP with a copy to the requester, whatever `SEND_PACKETS_TO` says. Either signer can send the request back with a note instead. Each press of **Sign** or **Send back** is claimed in a `Signatures` tab, and only the first claim on a signature goes through, so two signers at once can't make two authorized packets. Writes to the Requests tab change only their own cells. Signers see flags for a first mailed request, a changed address or a changed payee name, and get a receipt email after signing. The requester can resend to the signers once a day. `scripts/make-fo10-template.mjs` makes `assets/fo10-template.pdf` from CAPTA's form in `specs/`.
- The AP dashboard at `/ap` is for `Users` rows with `role` = `ap` or `admin`, checked on every page load; anyone else who opens it lands on their own requests, and *My requests* links AP members to it. It lists what's with AP (not Paid, and not still with an event chair or the check signers), oldest first, with each request's age: since it reached AP (after its chair and check signers), since its return for Returned, and since the last email while it waits for a chair or the signers. The filters pick a status, a fiscal year, paid requests too, or a search over the name, email, purpose and request ID, and **Export CSV** downloads what they show: one row per request, UTF-8 with a byte-order mark for Excel, with text that would run as a formula kept as text. A mailed check shows the address and amount it was signed with, from its JSON, and a warning when the Sheet's row says otherwise. Phase 2a only reads, apart from the budget category: AP picks it from the `Categories` tab on the request's page (it starts on the FO10's Budget Account when that names a category), which writes only the `budget_category` cell and adds a row to the `Actions` tab saying who set it and when. The request page lists those rows as its history.
- AP's steps (Phase 2b) are on each request's page, for anyone but the requester: nobody can act on their own request. **Approve** is optional and emails nobody. **Return with a note** makes it Returned and emails the requester the note and a link to *Fix and re-sign*, with AP copied; returning a written check voids it, and its number stays in the `Actions` tab. **Record check** needs the budget category, and takes the check number and date; it makes the request *Check written* until the check has both signatures and goes out, unless its "already signed and sent" box is ticked. For a check mailed by bill pay it's **Record bill pay**, with the bank's confirmation and the day the payment was set up. **Mark sent** makes it Paid and emails the requester where the check went; a bill pay email gives the address and amount from the request's JSON, never the row. Each step runs under the row's lock and checks the status again once it holds it, writes `approved_*`, `check_*`, `paid_*` or `returned_*`, and adds a row to `Actions`. A new version clears them. A failed email is noted on the row, and the page says to tell the requester.
- Who can sign in is the `Users` tab: approved addresses get links (one a minute, tracked on the row); unknown addresses are never emailed, the approver is, once, and at most 20 new pending addresses are recorded a day. The in-memory limiter (5 per address, 20 per IP every 15 minutes) sits in front as a first line.

## Not yet built

Reminders for the check signers (see `specs/Mailed Check — Spec.md`), the rest of Phase 2 (the weekly digest to AP) and Phase 3 (a file QuickBooks can import, and receipt OCR).
