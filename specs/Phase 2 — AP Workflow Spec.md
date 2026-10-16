# Phase 2 — AP Workflow Spec

Oct 15, 2026 · Draft v0.1 · Companion to the *Teacher Reimbursement Portal — Product Spec* (v0.2), which stays the source of truth for decisions already made.

## Overview

Phase 1 gets a complete, signed packet to ap@miralomasf.com and logs it as a row in the request-log Sheet. After that the portal goes quiet: AP has no way to act on a request inside it, teachers hear nothing until a check appears, and nothing flags requests that are sitting too long.

Phase 2 adds the AP team's side: a list of every open request with its age, the ability to return a request with a note, record the check when it is written, and mark it sent once the second signature is on it, automatic emails to the teacher when it matters, a weekly nudge about anything still open, and a CSV for the bookkeeper. The signed PDF is never modified; the Sheet records what happened to it.

**Two signatures per check.** The PTA requires two signatures on every check before it goes out, so there is a gap between "check written" and "check in the teacher's hands". The portal models that gap as its own status so the teacher is never told to look for a check that is still waiting for a signature, and so checks waiting for the co-signer are visible instead of sitting in a folder.

**Defaults.** Several choices are still open. Each is written here as a default and listed again under *Open questions* so the treasurer can accept or change it. Build follows the defaults unless changed.

## Goals and non-goals

**Goals**

- Every open request is visible in one list with its age, and nothing is lost between the inbox and the checkbook.
- Returning a request, recording a check, or marking it sent takes under a minute from a phone or laptop.
- Checks waiting for the second signature are listed, oldest first, so none is forgotten.
- The teacher is told automatically when a request is returned or paid, with the note or check number.
- Requests older than a week get a weekly reminder to AP without anyone remembering to look.
- The treasurer can pull a clean export for bookkeeping at the end of a month or year.

**Non-goals**

- Writing checks or recording bank activity. Payment stays outside the portal.
- Approving the spending itself. Board or membership approval of the budget line happens outside the portal; the portal only tracks the reimbursement.
- Editing a signed PDF. A corrected request is signed again as a new version.
- Replacing the Sheet. It remains the log and may still be edited directly.

## Users and access

| Role | How they get it | What they can do |
| --- | --- | --- |
| Requester | Approved in the Users tab (Phase 1) | Submit, re-sign a returned request, see their own requests |
| AP | `role` = `ap` in the Users tab | Everything a requester can, plus the AP dashboard: see every request, assign the category, approve, return, record the check, mark it sent, export CSV |
| Admin | `role` = `admin` in the Users tab | Everything AP can. Maintains the Users and Categories tabs by editing the Sheet; there are still no admin screens |

Sign-in is unchanged: a one-time email link. The role is read from the Users tab on every AP page load, so changing a role in the Sheet takes effect immediately. The check co-signer (often the president) can be given the `ap` role so they can mark checks sent themselves after signing; nothing else requires it.

**Acting on your own request.** An AP member who is also a teacher may submit requests, but the dashboard does not let anyone approve, return, record a check for, or mark sent a request where the requester email is their own. Another AP member must do it. *(default; see Open questions)*

## Status model

A request is always in exactly one status. *Draft* from the main spec lives only in the teacher's browser and never reaches the Sheet.

| Status | Meaning | Set by | Sheet columns written | Email sent |
| --- | --- | --- | --- | --- |
| Submitted | Signed and sent to AP | The app, on submit or resubmit | `submitted_at`, `version`, `pdf_file_id`, `pdf_sha256` | Packet to ap@, copy to the teacher |
| Approved | AP has reviewed it and will pay | AP | `approved_at`, `approved_by` | None *(default)* |
| Returned | AP needs a change before paying | AP, note required | `returned_at`, `returned_by`, `returned_note` | Teacher: the note and a link to fix it |
| Check written | The treasurer has written the check; it is waiting for the second signature | AP, check number and date required | `check_number`, `check_date`, `check_written_by` | None. The teacher's request page shows "Check written, awaiting second signature" |
| Paid | Both signatures are on the check and it has gone out, to the staff mailbox or the mail | AP or the co-signer | `paid_date` (the date it went out), `paid_by` | Teacher: check number, date, and where the check went |

**Transitions**

| From | To | Who | Notes |
| --- | --- | --- | --- |
| Submitted | Approved | AP | Optional step *(default: optional)* |
| Submitted | Check written | AP | Check number and date required; category must be set |
| Submitted | Returned | AP | Note required |
| Approved | Check written | AP | As above |
| Approved | Returned | AP | Note required |
| Check written | Paid | AP or co-signer | Date defaults to today. The Record check form has an "already signed and sent" box for when both signers are in the room, which does both steps in one go |
| Check written | Returned | AP | Note required; the voided check number stays in the Actions tab |
| Returned | Submitted | Teacher | Re-signs; `version` increments, new PDF |
| Paid | anything | Admin, by editing the Sheet | Paid is final in the portal. Fixing a mistake is a Sheet edit plus a note in `notes` |

Every action also appends a row to an **Actions** tab: `request_id`, `action`, `by`, `at`, `note`. That is the audit trail; the Requests row holds only the latest state.

**Budget category** is separate from status. AP can set it at any point before the check is written, and Record check requires it to be set *(default)*.

## Resubmission

When a request is returned:

1. The teacher gets an email with the AP note and a link to the request.
2. Opening the request shows the note at the top and a **Fix and re-sign** button. The form opens filled in exactly as last submitted: details, line items and receipts.
3. The teacher may change anything: edit lines, remove or add receipts, change the amount. *(default)*
4. They preview and sign again. The app builds a new packet, stores it as `FY27-042-v2.pdf` beside the earlier one, sets `version` to 2, points `pdf_file_id` and `pdf_sha256` at the new file, keeps the previous file ids in `previous_pdf_file_ids`, and sets status back to Submitted.
5. AP receives a new packet email marked *version 2* that includes the return note it answers.

To refill the form, the app saves the exact request content as `request.json` in the request's Drive folder at every submission (`request_file_id` on the row). Receipts already in Drive are reused by id; nothing is re-uploaded unless the teacher adds a new one.

## AP dashboard

**/ap** — the list. Requires role `ap` or `admin`; everyone else gets the normal teacher pages.

- Columns: request ID, submitted, requester, purpose, reimbursement claimed, category, status, age, version.
- Age is days since submission for Submitted and Approved, days since return for Returned, and days since the check was written for Check written. It is blank for Paid.
- Default view: everything not Paid, oldest first. Filters: status, fiscal year, and a search box over name, email and purpose. A toggle shows Paid requests.
- An **Awaiting signature** filter shows only Check written requests with their check numbers and amounts, oldest first. It is the co-signer's to-do list.
- Export CSV applies the current filters.

**/ap/[id]** — one request.

- Everything on the row, the AP note history from the Actions tab, and links to the current signed PDF and any previous versions.
- The action panel: a category dropdown, and the buttons **Approve**, **Return with a note**, **Record check**, **Mark sent**. Return opens a note field. Record check asks for the check number and date (defaults to today) and has an "already signed by both and sent" box. Mark sent asks only for the date (defaults to today) and reminds whether the check goes to the staff mailbox or the mail.
- After an action the page reloads from the Sheet. Two AP members acting on the same request at the same moment is last-write-wins; at this volume that is acceptable, and the Actions tab shows both.
- The buttons are disabled on your own request.

The pages are responsive so the treasurer can clear requests from a phone.

## Notifications

| Event | To | Content |
| --- | --- | --- |
| Returned | Teacher | The AP note, who to contact, and a link that opens the request to fix |
| Check written | Nobody | The status is visible on the teacher's request page, but no email: the check is not in their hands yet |
| Paid | Teacher | Check number, the date it went out, and "in your staff mailbox" or "mailed to [address]" |
| Resubmitted | ap@ | The new packet, marked with the version and the note it answers |
| Weekly digest | ap@ | Every request not Paid that was submitted more than 7 days ago: ID, requester, amount, status, age, with checks awaiting signature in their own section. Sent Monday at 8 AM Pacific. Not sent when the list is empty *(defaults)* |

Approved sends nothing *(default)*. The digest runs as a Vercel cron job, which the Hobby plan supports at this frequency, protected by a secret so only Vercel can trigger it.

## CSV export

One row per request, latest version only, UTF-8 with a byte-order mark so Excel opens it cleanly.

Columns: `request_id`, `status`, `submitted_at`, `check_date`, `check_number`, `paid_date`, `budget_category`, `payee_name`, `pta_position`, `requester_email`, `purpose`, `total_expense`, `donation_to_pta`, `reimbursement_claimed`, `check_delivery`, `line_count`, `receipt_count`, `version`, `approved_by`, `paid_by`, `pdf_sha256`.

If the treasurer's bookkeeping software has an import format, the export should match it instead. *(Open question 6)*

## Budget categories

A **Categories** tab in the Sheet: `name`, `active` (yes/no), `order`. The treasurer edits it each fiscal year; inactive names stay on old requests but disappear from the dropdown. The app writes a starter header row on first use and shows an "Uncategorized" option until the tab has rows. *(default)*

## Data changes

Requests tab, new columns: `approved_at`, `approved_by`, `returned_at`, `returned_by`, `check_date`, `check_written_by`, `paid_by`, `request_file_id`, `previous_pdf_file_ids`. The existing `paid_date` now means the date the signed check went out. The app appends any missing header to the end of the header row on first use, so the existing tab does not need to be rebuilt.

New tabs: `Actions` and `Categories`, created with headers on first use.

Drive: each request folder gains `request.json` and, after a return, additional PDF versions. Nothing is deleted.

## Security and privacy

- AP pages and action handlers check the role on every request; a teacher who guesses an `/ap` URL gets their own pages.
- The weekly digest and the cron route are protected by a `CRON_SECRET` that only Vercel sends.
- Every action is attributed to the signed-in AP member's email in the Actions tab.
- The Paid email includes the mailing address only when the check was mailed, and only to the requester.

## Rollout

1. **2a — See.** Role check, the dashboard list and detail pages read-only, the category dropdown, and CSV export. Lets the treasurer start using it immediately.
2. **2b — Act.** Approve, Return with note, Record check, Mark sent, the teacher emails, and the resubmission flow with versions.
3. **2c — Nudge.** The weekly digest.

Each step is usable on its own. Pilot 2a with the treasurer on live data; nothing in it writes to the Sheet except the category.

**Success measures.** Days from submission to Paid, share of requests returned, and a weekly digest that trends toward empty.

## Open questions

Each has a default. The build follows it unless changed here.

| # | Topic | Proposed default |
| --- | --- | --- |
| 1 | Approved step | Optional; AP can go from Submitted straight to Paid; no email on Approved |
| 2 | Budget categories | A Categories tab in the Sheet, edited by the treasurer each fiscal year; dropdown only |
| 3 | Category required | Must be set before Record check |
| 4 | Who acted | Every action records the AP member's email and time in an Actions tab |
| 5 | The PDF after payment | Untouched. Check number, dates and category live in the Sheet. The alternative is a second "paid" copy with the treasurer block filled in for the audit binder |
| 6 | CSV format | Generic columns above. Which bookkeeping software does the treasurer use, so the export can match its import? |
| 7 | What a returned teacher can change | Anything, with a fresh signature; the new version gets its own PDF and a fresh email to AP |
| 8 | Weekly digest | Monday 8 AM Pacific; requests not Paid and older than 7 days; skipped when empty |
| 9 | Acting on your own request | Blocked for every action; another AP member must do it |
| 10 | Undoing Paid | Admin edits the Sheet and writes a note; no Reopen button |
| 12 | Who marks a check sent | Whoever puts it in the mailbox or the mail. The co-signer may be given the `ap` role to do it right after signing |
| 13 | Voiding a written check | Return it with a note; the check number stays in the Actions tab and the new check gets a new Record check entry |
| 11 | VP/Chairman signature line | Still blank on the PDF (carried from the main spec). Does AP collect it on paper, or skip it? |
