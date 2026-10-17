# Teacher Reimbursement Portal — Product Spec

Oct 16, 2026 · @Russ · Draft v0.3

## Overview

A web form on miralomasf.com where a teacher uploads receipts, fills in a few details, and gets back one signed PDF (reimbursement form + receipts) emailed to ap@miralomasf.com (which includes the treasurer). It replaces today's paper form, separate receipt copies, and hand-delivery to the treasurer.

**Problem today:** teachers fill out a paper or emailed form, photocopy or photograph receipts, sign by hand, and get it to the treasurer. Packets arrive incomplete (missing receipts, budget line, or signature), the treasurer chases details, and there is no single place to see what is pending or paid.

**What the portal does:** collects the request in a structured form, assembles a standard PDF with the receipts attached, captures the teacher's signature electronically, notifies the treasurer, and tracks the request through approval and payment. Each request also says which stipend it comes from, and teachers and staff can see how much of each stipend is left.

## Goals and non-goals

**Goals**

- A teacher can submit a complete request from a phone in under 5 minutes, including photographing receipts.
- Every submission produces one PDF: the PTA reimbursement form on page 1, receipts on the following pages.
- The teacher signs electronically; no printing or scanning.
- The treasurer gets a complete, consistent packet every time and can see all open requests in one list.
- Teachers and staff with a stipend can see how much is left before they spend, and the treasurer sees which stipend every request comes from.
- Zero added running cost: no paid services or subscriptions (hard requirement). Sized for about 50 requests a month.

**Non-goals (for now)**

- Issuing payment. Teachers stay on paper checks; the portal only records the check number and date.
- Replacing the PTA's bookkeeping software. The portal shows where each stipend stands so requesters can plan, but it never blocks a request for going over; the treasurer's books stay the record.
- Purchase pre-approval or purchase orders.
- Checking who a requester is beyond the one-time approval of their email address. The PTA still only reimburses staff and approved volunteers, and AP confirms that at review.

## Users and roles

| Role | Who | What they do in the portal |
| --- | --- | --- |
| Teacher | Classroom teachers, each approved once by email address; `role` = teacher in the Users tab | Submit requests, choose which stipend each comes from, sign, see their own requests and their stipends |
| Staff or volunteer | Other staff and approved volunteers, approved the same way; `role` = requester | Submit requests, sign, see their own requests. Staff with their own stipend also choose whether each request comes from it |
| AP team | Everyone on ap@miralomasf.com, including the treasurer | Approve new requester addresses and mark each as teacher or staff, receive every signed packet, review, assign the budget category, return with a note, mark paid with check number. The treasurer keeps the Stipends tab's amounts current each fiscal year |
| Admin | PTA tech volunteer | Maintain the Users and Stipends tabs of the request-log Sheet: pre-approve addresses, set roles, grades and stipends, fix mistakes |

Only the requester signs; no second signature is collected in the portal. The form's *Signature of VP/Chairman for Program/Event* line and the *For PTA treasurer use* block stay blank for AP to handle outside the portal.

Sign-in uses one-time links emailed to the requester: no passwords and no Google account. Links expire after 15 minutes and work once. Who may sign in is the *Users* tab of the request-log Sheet:

- An approved address gets a sign-in link, at most one a minute.
- An unknown address gets nothing. It is added to the tab as pending, and one email goes to the approver address (ap@miralomasf.com by default) with an approve/deny link that works for 7 days. On the approval page the approver says whether they are a teacher (and which grades) or staff, and can enter a staff stipend. Approving flips the row and emails the teacher a sign-in link right away; denying is silent. Repeat requests from a pending or denied address send nothing.
- The admin can paste staff addresses into the tab as approved ahead of time, with their role, grade and stipend, so most teachers never wait.

Because nothing is ever emailed to an unknown address, the form can't be used to spam strangers; the worst case is a bounded trickle of approval requests to ap@, capped at 20 new pending addresses a day. The tab's *role* column (requester, teacher, ap, admin) marks who gets the teacher stipends and is also the AP list that unlocks the dashboard in Phase 2. The approval page only chooses between teacher and requester; ap and admin are set in the Sheet, and approving never changes them.

The reply to a sign-in request says whether a link was sent or the address was queued for approval, so it reveals whether an address is on the list. Accepted: the list is school staff and approved volunteers, nothing is emailed to the address either way, and one vague reply would leave a new teacher unsure whether to wait for approval or check spam. Every page and API call re-reads the Users row, so a denied or deleted address loses access at once, not when its 30-day session runs out.

## User flow

&#91;embedded content: request flow · teacher and treasurer, 1 decision\]

The teacher's whole job ends at signing; the PDF is built and sent automatically. A returned request reopens at the details step with the AP team's note, and the teacher re-signs.

## Functional requirements

### 1. Request form

Fields map one-to-one to the PTA's *Payment Authorization / Request for Reimbursement* form (Revised July 2022), which is a fillable PDF. The portal fills the requester's half through the form's own fields; the *Signature of VP/Chairman* line and the *For PTA treasurer use* block are left blank for AP to complete outside the portal. The *Template field* column is the field name in the app's copy of the form (see *PDF generation*).

| Form field | Template field | Portal input | Notes |
| --- | --- | --- | --- |
| Name of Payee | payee_name | Text | |
| PTA Position | pta_position | Text, e.g. "Teacher, Room 12" | |
| Check delivery | — | Choice: mail or staff mailbox | Not on the form; printed in the form's margin and in the email to AP |
| Address, City/Zip | address, city_zip | Text | Required only when the check is mailed |
| Telephone | phone_area_code, phone_number | Text, required | |
| Email | email | Prefilled | From the sign-in link |
| Expenditure was for | purpose | Text | Purpose, e.g. "2nd grade art supplies" |
| Paid from | — | Choice, required when shown | Which stipend the request comes from. Not on the form; recorded in the Sheet and in both emails. The choices depend on the requester; see *Stipends* |
| List Expenditures (4 lines) | item_1_description, item_1_amount … item_4_description, item_4_amount | Repeating line items: description, amount, receipt | One line item per receipt. Description capped at 30 characters to fit the form. Amount may be less than the receipt total (partial reimbursement is allowed). More than 4 lines → see *PDF generation* |
| TOTAL EXPENSE | total_expense | Calculated | Sum of line items |
| Total Amount Claimed From Above | total_claimed | Calculated | Equals total expense |
| Minus Advance Received | advance_received | Hidden, always $0 | Teachers don't receive advances |
| Reimbursement Claimed | reimbursement_claimed | Calculated | Total minus any amount donated |
| Not claimed – donate to PTA | donation_to_pta | Number, default $0 | Lets a teacher donate part of the total |
| Refund to PTA (Enclose Check) | refund_to_pta | Hidden, always $0 | Only applies to advances |
| Signature, Date | requester_signature, requester_signature_date | Built-in signature step | Date filled automatically |
| Budget category | treasurer_category | Not collected | AP assigns the budget line at review and records it in the Sheet; the form's Category box is in the treasurer block and stays blank |

Name, PTA position, phone, check delivery and address start filled in from the requester's most recent request, so a repeat request only needs the purpose and the receipts. There is no separate profile store; the request log is the source.

### 2. Receipt upload

- One receipt per line item. A receipt that needs more than one photo (a long receipt, front and back) can have several images under the same line.
- Accept JPG, PNG, HEIC (iPhone default) and PDF, up to \~10 MB each.
- Take a photo directly from the phone camera.
- HEIC is converted to JPEG in the browser before upload; the server never handles HEIC.
- Files upload from the browser straight to the Drive folder through a resumable upload session the app creates, so receipts never pass through the app server (Vercel caps request bodies at 4.5 MB).
- When the packet is built, images become PDF pages, auto-rotated and downscaled so the packet stays under \~10 MB.
- Optional later: read vendor, date and total from the receipt (OCR) to prefill the line item.
- Validation: every line item must have a receipt. No receipt-age cutoff. The claimed amount is not checked against the receipt total.

### 3. PDF generation

- Page 1: the official PTA form (Revised July 2022), filled through its fillable fields and then flattened, so it looks exactly like the paper version.
- The app's template is `PaymentAuthorizationRequestforReimbursement-template.pdf` (currently in `specs/`): the official PDF with its 34 fields renamed to the names in the table above. The original had names like `undefined_7`, `Text208` and `Signature203_es_:signer:signature`; nothing else was changed, and the PTA's original file is kept alongside.
- Three things are stamped outside the fields: the check-delivery note in the margin, the request ID and timestamp in the footer, and a drawn signature image placed on the signature line. A typed signature fills the box as italic text.
- The description boxes fit about 20 characters at a readable size and the amount boxes about 8; the font auto-shrinks for longer values, and the form caps descriptions at 30 characters.
- The form has 4 expenditure lines. With 5 or more items, lines 1–3 are itemized, line 4 reads "Additional items – see schedule" with their subtotal, and a schedule page lists every item.
- Following pages: each receipt, labeled with its line number and amount.
- Teacher's signature and date go in the signature fields. Fields the portal never fills: vp_chair_signature, treasurer_check_number, treasurer_category, treasurer_amount_advanced, treasurer_expenses, treasurer_amount_owed_or_due, president_signature, president_signature_date, minutes_approval_date, secretary_signature. The three treasurer checkboxes are printed, not fields.
- Request ID and submission timestamp in the footer of every page; an audit page at the end.
- If the PTA issues a new form revision, the field names and positions must be re-checked and the template replaced by a developer; it is not an admin setting.

### 4. Signing

- Decided: built-in signature, no third-party service.
- Last step of the form: the teacher previews the full PDF, ticks "I agree to sign electronically," then types their name or draws a signature with a finger or mouse.
- The app stamps the signature, name and date onto the form and appends an audit page: signer name and email, sign-in method and time, signature method (typed or drawn), timestamp, IP address, browser, and the consent text. The SHA-256 hash of the finished file is recorded in the request log and in both submission emails (it cannot be printed inside the file it describes).
- The signed PDF is locked; any change after signing requires a new signature.

### 5. Review and tracking

- AP dashboard: list of requests with status, amount, category, age; filter by status.
- AP assigns the budget category at review. It lives in the Sheet and the CSV export, not on the teacher's form.
- Statuses: Draft → Submitted → Approved / Returned → Check written → Paid. *Check written* covers the gap while a check waits for the PTA's required second signature; the teacher is emailed only at Paid, when it has gone out.
- Returned requests go back to the teacher with a note; they edit and re-sign.
- AP records the check number and date when the check is written, and marks it Paid once both signatures are on it and it has gone out.
- The request-log Sheet may be edited directly. The app finds rows by request ID and columns by header name, so sorting, filtering and adding columns are safe; renaming a header breaks it. Status changes should still be made in the dashboard, because that is what sends the teacher's email and writes the audit trail; a status typed into the Sheet sends nothing.
- CSV export for bookkeeping.

### 6. Notifications

- Every completed request: signed PDF emailed to ap@miralomasf.com, with a copy to the requester. Both say which stipend the request comes from and where that stipend stands after it, e.g. "Paid from: Grade 2 stipend (shared by grade 2 teachers): $1,200.00, $529.15 claimed including this request, $670.85 left".
- Requester emailed when a request is returned (with the note) and when it is paid (check number and date).
- Weekly digest to ap@miralomasf.com of anything not marked paid after 7 days.

### 7. Stipends

Some requesters spend against PTA stipends that reset each fiscal year (July to June). Every request records which stipend it comes from, and the portal shows how much of each is left.

| Stipend | Who can choose it | Amount comes from | Shared |
| --- | --- | --- | --- |
| Classroom stipend | Teachers | The *Classroom* row of the Stipends tab, the same for every teacher. A teacher's own *stipend* in the Users tab replaces it (a job share, say) | No: each teacher's own |
| Grade *N* stipend | Teachers of grade *N*; a teacher of several grades (a combination class) gets one choice per grade | The *Grade N* row of the Stipends tab | Yes: by that grade's teachers |
| Field trip | Teachers | The *Field trip* row of the Stipends tab | Yes: by all teachers, school-wide |
| Stipend | Anyone else with their own stipend (staff) | Their *stipend* in the Users tab | No |
| Not from a stipend | Everyone who is asked | — | — |

- **Who is asked.** Teachers (`role` = teacher) choose among their classroom stipend, the stipend of each grade they teach (one per grade for a combination class, none if their row has no grade), the field-trip fund, or not from a stipend. Anyone else with their own stipend chooses it or not. Everyone else is not asked, and the request's *funding* cell stays blank.
- **Required.** When the choice is shown, the requester must pick one. The server rejects a stipend the requester doesn't have.
- **What counts.** The reimbursement claimed (after any donation to the PTA) on this fiscal year's requests charged to the stipend, by everyone who shares it. A request belongs to the fiscal year in its ID, the year it was first submitted. Returned requests don't count until they are re-signed. Paid and unpaid requests both count; the portal says how much is not paid yet.
- **Where it shows.** *My requests*: a bar for each stipend with what has been claimed and what is left, and the stipend beside each request. The form: what is left on each choice, then what will be left after this request. The confirmation screen, the request's page, and both submission emails.
- **Going over.** A warning, never a block. The requester can still submit; AP decides what to reimburse.
- **Where amounts live.** A Stipends tab in the request-log Sheet with columns *name*, *amount* and *note*, and rows *Classroom*, *Field trip*, *Grade TK* (transitional kindergarten), *Grade K*, *Grade 1*, and so on. The treasurer updates it each fiscal year; the amounts always apply to the current year. A stipend with no amount is still offered and recorded, and shows "No amount set".
- **In the Sheet.** The choice is stored as a readable label in the Requests tab's *funding* column ("Grade 2 stipend", "Field trip", "Not from a stipend"). AP may correct it there, and the totals follow.
- **Not the budget category.** AP's budget category stays separate and is still assigned at review. The stipend is not printed on the signed PDF.

## E-signature options

Decided: a built-in signature step, no third-party e-signature service. Any added cost is a non-starter, and a teacher signing their own expense claim after signing in with their own account is a valid electronic signature under the US ESIGN Act and California UETA. The audit page (see *Signing*) records who signed and when.

Why paid services were ruled out at \~50 requests a month, even with DocuSign nonprofit pricing available:

| Service | Cost at \~50 requests/month |
| --- | --- |
| [DocuSign API](https://signeasy.com/blog/business/docusign-api-pricing) | Starter ($50/mo billed yearly) caps at 40 envelopes/mo, so the next tier (Intermediate, $300/mo yearly) before any nonprofit discount |
| [Anvil Etch](https://www.useanvil.com/ask-anvil/e-signatures/cheapest-way-add-e-signatures-pdf-forms/) | $1.50 per packet after 25 free: about $37.50/mo |
| [Dropbox Sign API](https://help.dropbox.com/plans/how-much-does-the-dropbox-sign-api-cost) | Paid plan required for embedded signing |
| Documenso self-hosted | Free software, but another server to run and maintain |

## Technical architecture

Recommendation: a small custom web app (option C) that keeps all data in the PTA's existing Google Workspace, so the only new piece is the app itself on Vercel's free (Hobby) tier. At \~50 requests a month (about 600 a year), a Google Sheet is enough as the request log, which also gives AP a familiar view and removes the need for a database server.

| Option | How it works | Pros | Cons |
| --- | --- | --- | --- |
| A. Google Form + Apps Script | Form collects details and uploads to Drive; script fills a Docs template, merges receipts into a PDF, emails it | Free if we have Workspace; no hosting | Clunky receipt-to-PDF merging; weak signing; hard to show status |
| B. Form-builder SaaS (e.g. Jotform) | Off-the-shelf form with file upload, PDF output and built-in e-sign | Fastest to launch; no code | Monthly fee; PDF layout and receipt pages harder to control; data in a third party |
| C. Custom web app | Next.js app on Vercel's free tier; Workspace Drive, Sheet and Gmail for storage and email; PDF built in code | Exact PDF layout, built-in signing, treasurer dashboard, $0 on free hosting | Needs a volunteer developer to build and maintain |

&#91;embedded content: recommended architecture · 1 app on the PTA's Google Workspace\]

The app holds no data of its own: receipts and signed PDFs go to a Workspace Drive folder (the backup and the archive are the same place), each request is a row in a Sheet, and sign-in links and packets go out through Gmail. The fs@miralomasf.com account owns the folder and Sheet and sends all email.

**The Sheet.** Three tabs: *Requests* (one row per request), *Users* (who may sign in, their role, grade and stipend) and *Stipends* (the year's amounts). The app writes each header row on first use and creates a tab that is missing. When the app gains a column, it adds the header to the end of the existing row, widening the tab first if needed, so the Sheet never needs rebuilding.

**Workspace access.** The PTA is on Google Workspace for Nonprofits. The app acts as fs@miralomasf.com through a service account with domain-wide delegation for the Drive, Sheets and Gmail scopes, which the super admin authorizes once in the Admin console. Service accounts no longer have Drive storage of their own, so everything is written into fs@'s Drive.

**Uploads.** Receipts go from the browser straight to Drive through resumable upload sessions the app creates; HEIC is converted in the browser. The app server only reads files back from Drive to build the packet.

**Ownership.** The code lives in a PTA-owned GitHub organization and the Vercel project in an account under fs@miralomasf.com, not in a volunteer's personal accounts, so nothing is lost when a volunteer moves on.

**Environments.** One. There is no separate pilot or staging environment; the pilot runs on the live app with real submissions to ap@miralomasf.com.

## Data, privacy and retention

- **What we store:** name, PTA position, mailing address (only if the check is mailed), phone, email, purchase details, receipt images, signed PDFs, audit log, each requester's role, grade and stipend amount, and which stipend each request comes from. No bank or card numbers; payment stays by check.
- **Where:** a Google Workspace Drive folder and Sheet owned by fs@miralomasf.com, shared only with the AP team and the admin. The app keeps nothing after it writes there.
- **Receipts can contain personal data** (partial card numbers, home addresses on online orders). Show a tip to crop or cover these before upload.
- **Access:** requesters see only their own requests in the app; files are never public links. A shared stipend shows only the total claimed by everyone sharing it, never who claimed what.
- **Retention:** keep all signed packets and request records indefinitely; nothing is deleted automatically.

## Rollout plan

1. **Phase 0 — Setup.** The Workspace super admin creates a Google Cloud project under the miralomasf.com organization, enables the Drive, Sheets and Gmail APIs, creates the service account and authorizes its domain-wide delegation. Under fs@miralomasf.com: create the Drive folder and the request-log Sheet with Requests, Users and Stipends tabs (the app creates any that are missing), have the treasurer enter the year's stipend amounts, create the Vercel project, and point the hostname at it. Create the PTA GitHub organization.
2. **Phase 1 — MVP.** Sign in, form matching the PTA form, receipt upload with camera, PDF packet, built-in signature, email to ap@miralomasf.com, row in the Sheet, and the stipend choice with what's left in each stipend. Pilot with 3–5 teachers on the live app.
3. **Phase 2 — AP workflow.** Return with a note, mark paid with check number, paid/returned emails to teachers, weekly digest. Detailed in *Phase 2 — AP Workflow Spec* (same folder).
4. **Phase 3 — Nice to have.** Receipt OCR to prefill line items.

Success measures: share of requests submitted online, requests returned for missing info, and days from submission to payment.

## Decisions

| Topic | Decision |
| --- | --- |
| Form | The PTA's Payment Authorization / Request for Reimbursement form, Revised July 2022 (fillable PDF); the app fills a copy with renamed fields |
| Signatures | Requester only; the VP/Chairman line and the treasurer block stay blank |
| Signing method | Built-in electronic signature; no DocuSign or other paid service |
| Routing | Every completed request goes to ap@miralomasf.com (includes the treasurer) |
| Payment | Paper check, unchanged |
| Budget category | Assigned by AP at review, not collected from the teacher |
| Teachers | Marked by `role` = teacher in the Users tab, set on the approval page or in the Sheet |
| Stipends | Classroom (one standard amount per teacher), grade-level (one shared fund per grade), field trip (one fund for the whole school, not per grade), and staff stipends (per person). Each request names one, or "Not from a stipend" |
| Grades | TK (transitional kindergarten), K and 1–5, plus any other grade the Stipends tab names. A teacher may teach several (a combination class): ticked on the approval page, or listed with commas in the Users tab's *grade* cell, like "1, 2" (not "1/2", which the Sheet turns into a date) |
| A teacher's own stipend | Overrides the standard classroom amount for that teacher |
| AP and teacher roles | No AP member is also a teacher, so the role column's single value is enough |
| Stipend on the PDF | Not printed; it is recorded in the Sheet and both emails |
| Stipend limits | Shown, never enforced; AP decides |
| Stipend year | PTA fiscal year (July to June), by request ID |
| Line items | One line item per receipt |
| Partial receipts | Allowed; the claimed amount may be less than the receipt total |
| Phone number | Required |
| Remembered details | Name, position, phone, check delivery and address prefill from the requester's last request; no separate profile store |
| Receipt age | No cutoff |
| Storage / backup | Google Workspace folder |
| Budget | Zero added cost |
| Volume | About 50 requests a month |
| Sign-in | One-time email links; addresses are approved once via an approval email to ap@, recorded in the Users tab of the Sheet |
| Hosting | Vercel free (Hobby) tier, in an account under fs@miralomasf.com |
| Code | PTA-owned GitHub organization |
| Workspace | Google Workspace for Nonprofits; fs@miralomasf.com sends email and owns the Drive folder and Sheet; the app acts as fs@ through a service account with domain-wide delegation |
| Uploads | Browser to Drive directly; HEIC converted in the browser |
| Request-log Sheet | AP may edit it directly; status changes go through the dashboard |
| Environments | No separate pilot environment |
| Check delivery | Teacher chooses: mailed or left in the staff mailbox |
| Treasurer-use block | Left blank on the PDF for AP |
| Advances | None; advance and refund fields hidden and set to $0 |
| Retention | Keep records forever |

## Open questions

Each has a proposed default. The build follows the default unless it is changed here.

| Topic | Proposed default |
| --- | --- |
| Hostname | reimburse.miralomasf.com. Who can add the DNS record? |
| Admin screens | None in the MVP; the Users tab in the Sheet is the allow-list, the teacher list and the AP list, and the Stipends tab holds the amounts |
| VP/Chairman signature line | Left blank by the portal. Does AP collect it on paper afterward, or skip it? |
| Approved step | Optional; AP can go from Submitted straight to Paid. No email to the teacher on Approved |
| Resubmission after Return | Keeps the request ID, produces a new PDF version, sends a fresh email to AP; the earlier signed PDF stays in Drive |
| Drafts | Built: form state lives in the browser until signing; receipts upload to a pending folder as they are added; signed packets are kept forever. Not built yet: deleting pending uploads with no signed packet after 30 days |
| What "locked" means | Built: SHA-256 hash of the signed file in the Sheet and both emails; the app never rewrites the file. Not built yet: marking the file read-only in Drive. No certificate-based PDF signature |
| CSV export | One row per request with the Sheet's columns. Which bookkeeping software does the treasurer use, so the columns match its import? |
| Emails | PDF attached to both the AP email and the requester's copy; the body summarizes name, total, line items, check delivery and the stipend |
| Weekly digest | Monday morning; lists anything not Paid seven days after submission |
| Request ID | Sequential per PTA fiscal year, e.g. FY27-042 |
| Signatures | Drawn or typed fresh each time; never stored for reuse |

## Changes since v0.2

- Stipends: each request records which stipend it comes from (classroom, grade-level, field trip, a staff member's own stipend, or none), and the portal shows what is left in each, with a warning but no block when a request goes over. New *Stipends* tab; new *grade* and *stipend* columns in Users; new *funding* column in Requests. Added *Stipends* under Functional requirements.
- Roles: a *teacher* role marks teachers. The approval page now sets teacher or staff, the grades (TK, K or 1–5, several for a combination class) and a staff stipend; ap and admin are still set only in the Sheet.
- Sign-in: links work once (a `signed_in_at` column in Users records their use); every page and API call re-checks the Users row, so a denied or deleted address loses access at once; an approval link does nothing once a decision is on the row. The sign-in reply's sent-or-pending distinction is an accepted disclosure (see *Users and roles*).
- Receipts: a receipt belongs to one request. A file already moved into a request's folder is refused with the request it belongs to; the Phase 2 re-sign of a returned request is the one case to allow.
- Non-goals: budget tracking reworded. Balances are shown, not enforced.
- Sheet: the app creates a missing tab and appends columns it gains to the end of the header row.
- Open questions: the Drafts and "locked" rows now say what is built and what isn't.
- Decided: the field-trip fund is one for the whole school; a teacher's own stipend overrides the classroom amount; no AP member is also a teacher; the stipend is not printed on the PDF.
- Statuses: added *Check written* between Approved and Paid, for checks waiting on the second signature (detailed in the Phase 2 spec).

## Changes since v0.1

- Form: the Revised July 2022 fillable PDF replaces the 03/2009 reference. Added the renamed template, the field mapping, the VP/Chairman line, and the box-width limits.
- Sign-in: a fixed staff allow-list is replaced by a Users tab with one-time approval by email. Unknown addresses are never emailed; the approver is. Non-goals and roles reworded to match.
- Form content: budget category is assigned by AP; one line item per receipt; partial receipts allowed; phone required; requester details prefill from the last request.
- Architecture: Workspace for Nonprofits; service account with domain-wide delegation; uploads straight to Drive; HEIC converted in the browser; PTA-owned GitHub and Vercel under fs@; no pilot environment.
- Review: AP may edit the Sheet directly, with status changes through the dashboard.
- Added the Open questions section with proposed defaults.
