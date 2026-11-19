# Event Chair Signature — Spec

Nov 19, 2026 · Draft v0.3 · Companion to the *Teacher Reimbursement Portal — Product Spec* (v0.5) and the *Phase 2 — AP Workflow Spec*, which stay the source of truth for what they decide. Steps 1 and 2 of the rollout (*Sign*, *Send back*) are built; step 3 is not.

## Overview

The PTA form has a line for the *Signature of VP/Chairman for Program/Event*. Today the portal leaves it blank, and the packet goes on to AP as soon as the requester signs. When the money was spent on a PTA event, that event's chair knows whether the purchase belongs to it, and the PTA wants the chair's signature on the form.

This stage adds that step. An **Events** tab in the request-log Sheet lists each event, its chair and, optionally, its budget for the year. The form asks which event a request is for, and guesses the answer from the description. When the requester signs a request for an event, the app emails the event's chair a link. The chair opens the packet, sees what's left of the event's budget before and after it, and signs on the VP/Chairman line or sends it back with a note. Only after that does the packet go on to AP, with both signatures.

Requests that aren't for an event work exactly as they do today. The event question starts on *Not for an event*, there's no wait, and the line stays blank.

## Decisions

| Topic | Decision |
| --- | --- |
| Finding the event | The requester picks it from a list on the form. The app pre-selects it when the description names an event |
| Requests not for an event | No chair step. The VP/Chairman line stays blank, as today |
| Requester is the event's chair | No chair step. The packet goes on with the line blank |
| How the chair signs | Through a link in the email, tied to their address and that one request. No account or sign-in |
| Requester is a chair, and the event has a co-chair | Still no chair step. The co-chair isn't asked |
| Starting value of the event question | *Not for an event*, unless the description names exactly one event |
| Chair doesn't sign | Reminders at 3 and 7 days. At 14 days the request goes on with the line blank and a note (rollout step 3) |
| How long a chair link works | 14 days, for one version of one request. Each reminder or resend has a fresh link |
| Chair's copy | The chair who signs gets the co-signed packet by email, for their records |
| Re-signed versions | Every new version goes back to the chair, even after an AP return that changed nothing the chair saw |
| Event budget | Optional, per event, in the Events tab. The chair sees it before and after the request they're signing. Shown, never enforced |
| Event and budget category | Not linked for now. Later, a `category` column in the Events tab could pre-fill AP's budget category in Phase 2 |
| Who keeps the Events tab current | The admin, each fiscal year when the chairs change |
| Chair addresses outside miralomasf.com | Allowed, because chairs are often parents using personal addresses |

## Goals and non-goals

**Goals**

- Every request for a PTA event reaches AP with the chair's signature on the VP/Chairman line. Nobody prints, scans or forwards anything to make that happen.
- A chair can review and sign on a phone, starting from the email, in under two minutes and without an account.
- The requester can always see whose signature the request is waiting for.
- A slow chair never strands a request. The chair gets reminders, and after that the request goes on without the signature.
- Requests not for an event go through exactly as they do today.

**Non-goals**

- A signature on the VP/Chairman line for requests not tied to an event. That line stays blank.
- Letting the chair edit the request. They either sign it or send it back.
- Enforcing event budgets. The chair sees where the budget stands, and going over shows a warning but never blocks signing; AP decides.
- One request that covers several events. The requester splits it into one request per event.
- Approval of the event's budget, which the board or membership gives outside the portal.

## Who is involved

| Role | How they get it | What they do |
| --- | --- | --- |
| Requester | The Users tab, as today | Picks the event and signs. Sees who the request is waiting for, and can resend the chair email |
| Event chair | Listed for the event in the Events tab. No Users row or sign-in needed | Opens the request from the emailed link, then signs the VP/Chairman line or sends the request back with a note |
| AP | As today | Gets the packet once the chair has signed, or once the chair step was skipped or timed out |
| Admin | Edits the Events tab | Keeps the event list and the chairs current, usually at the start of each fiscal year |

Being listed as a chair in the Events tab is the approval. The app sends chair links only to addresses in that tab, and each link works only for its one request.

## The Events tab

A new tab in the request-log Sheet. The app creates it with its header row the first time it's needed.

| Column | Example | Meaning |
| --- | --- | --- |
| `name` | Fun Run | Shown in the form's event list and printed beside the VP/Chairman line. Up to 200 characters; a longer name is ignored |
| `chair_email` | lillie@example.com, norton@example.com | One or more addresses, separated by commas. Every co-chair gets the email, and any one of them may sign |
| `aliases` | fun-run, jog-a-thon | Optional. Other words for this event, used to guess the event from the description |
| `budget` | 1500 | Optional. The event's budget for this fiscal year, in dollars. The chair sees what's left of it |
| `active` | yes | `no` hides the event from the form. Requests that already name it keep it |
| `note` | | For the admin. The app ignores it |

The tab lists the current chairs. Each request records the addresses its email reached, so changing a chair later doesn't change who signed an older request. When the tab has no active rows, the form doesn't show the event question and every request goes through as today.

Two rows with the same name are read as one event, with all their chairs and aliases and the first budget given. When some of those rows are active, the inactive ones are left out, so last year's row kept beside this year's adds neither last year's chair nor its budget.

## The form

The form gets a new question after *Expenditure was for*: **Which PTA event was this for?** It's a list of the active events plus *Not for an event*, which starts selected.

**Guessing from the description.** While the requester types the purpose and the line descriptions, the app looks in them for each event's name and aliases. A match ignores case, spaces, hyphens and punctuation, but it has to be whole words. So "Fun Run", "fun-run" and "FunRun water" all match *Fun Run*, while an event called *Art* does not match "party supplies".

- If exactly one event matches, the list switches to it and shows a line underneath: "Picked from your description. Change it if that's wrong."
- If several events match, the list stays as it is, and the line asks which event it was.
- Once the requester changes the list by hand, the guess never changes it again.

**Before signing.** The preview step says what happens after signing:

- For an event: "After you sign, this goes to the Fun Run chair (lillie@example.com) to sign, then to the PTA."
- When the requester is a chair of that event: "You're a Fun Run chair, so this goes straight to the PTA."
- For an event with no chair listed: "No chair is listed for Fun Run, so this goes straight to the PTA."
- Not for an event: the same text as today.

The same line shows under the event question while the form is being filled in. The event is saved in the draft along with the rest of the form. If the draft names an event that has since come off the list, the form asks the requester to choose again, and the server refuses an event that isn't on the active list.

## When the chair step applies

| The request | What happens | `chair_step` |
| --- | --- | --- |
| Not for an event | Goes on as today | blank |
| For an event, and the requester isn't one of its chairs | Status becomes *Awaiting chair*, and every chair of the event gets the email | Waiting |
| For an event, and the requester is one of its chairs | Goes on as today, with the line blank. A co-chair isn't asked | Skipped: requester is a chair |
| For an event with no `chair_email` | Goes on as today, with the line blank | Skipped: no chair listed |

"Goes on as today" means the packet goes wherever `SEND_PACKETS_TO` sends it. That is either to AP with a copy to the requester, or only to the requester, who forwards it.

## Status model

This stage adds one status before *Submitted*.

| Status | Meaning | Set by |
| --- | --- | --- |
| Awaiting chair | The requester has signed, and the request is waiting for the event chair | The app, on submit, when the chair step applies |
| Submitted | Sent on to AP. Same meaning as before | The app, when the chair signs, when the chair step is skipped, or when the wait times out |
| Returned | Needs a change, and the note says what | The chair, by sending it back. In Phase 2, AP can also return a request |

**New transitions**

| From | To | Who | Notes |
| --- | --- | --- | --- |
| Awaiting chair | Submitted | The chair, by signing | The co-signed packet goes on |
| Awaiting chair | Returned | The chair, by sending it back | Note required. Built in rollout step 2 |
| Awaiting chair | Submitted | The app, after 14 days with no signature | The requester-signed packet goes on with the line blank, plus a note that the chair didn't sign. Comes in rollout step 3 |
| Returned | Awaiting chair | The requester, by re-signing | Every new version goes back to the chair, whoever returned it |

A request awaiting the chair counts against its stipend, the same as a submitted one. Only Returned requests are left out of stipend totals.

## The chair's email and page

**The email** goes to every address in the event's `chair_email`. Replies go to AP, not the requester: a reply quotes the email, link and all, and the link is all it takes to sign as the chair. The email asks a chair who finds a problem to send the request back from the signing page rather than reply or forward, and the signing page links the requester's address for a question, in a new email.

- Subject: "Please sign: Fun Run reimbursement for Harvey Milk, $123.45 (FY27-042)".
- The body gives the requester's name and position, the purpose, the line items and the totals, and has a **Review and sign** link. When the event has a budget, a line says where it stands: "Fun Run budget: $1,500.00. Before this request $120.00 was claimed, $1,380.00 left; after it, $1,337.50 left." It ends with a link to the chairs' guide at `/help/chairs`.
- The requester-signed packet is attached so the chair can read it in their mail app.
- It says nothing about stipends. Those are between the requester and AP.

**The page** at `/chair/FY27-042?t=…` shows the same summary and the packet with its receipts.

**The event's budget**, when the Events tab sets one, is shown at the top of the page:

- the budget for the year
- what the event's other requests have claimed this fiscal year
- what's left before this request
- this request
- what's left after it

The count works like the stipends. It covers every request for the event in the same fiscal year (by request ID), paid or not, including others still awaiting a chair, and leaves out returned ones. When this request takes the budget over, a yellow note says by how much, and that the chair can still sign because the PTA decides what to reimburse. Requesters don't see the event budget.

The page then offers two choices:

- **Sign.** The chair types their name, ticks "I agree to sign electronically", then signs by keeping the typed name or drawing a signature. This is the same signing step the requester uses. They can add an optional note to AP, such as "bought for the water station", which goes into the packet email.
- **Send back.** A note is required; the chair's address says who sent it back, so no name is asked. The requester gets the note by email, the request becomes *Returned*, every chair's link for that version stops working, and the requester fixes and re-signs it (see *Fixing a returned request*). Sending back takes the same row lock as signing, so a co-chair's signature and a send-back at the same moment can't both go through.

**How long the link works.** The link works for 14 days, for that one request and version, and only while the request is awaiting the chair.

**Checks on every visit.** Each time the page opens or the chair presses a button, the app re-reads the request's row and the Events tab. An address that has been removed from the event stops working right away, for the signed request as well as the unsigned one. If the event has gone from the tab altogether (renamed or deleted), the chairs the request already reached can still sign it, and a resend goes to them, so the request isn't stranded.

**One signature.** Signing holds a short lock on the request's row (see *Data changes*), so two co-chairs pressing **Sign** at the same moment can't both go through: one signs, and the other is told the request is being signed.

**Link scanners.** Opening the link only shows the page, and nothing happens until the chair presses a button. Email security scanners that open links therefore can't sign anything.

**After someone has acted.** Once one co-chair has signed, the other chairs' links show "Already signed by norton@example.com on Nov 14". A request that has timed out shows that it went on to the PTA without a chair signature.

## The co-signed packet

The requester's signed PDF is never changed. Before co-signing, the app checks that the file's SHA-256 still matches the one recorded when the requester signed; if it doesn't, it refuses and asks the chair to tell the PTA. When the chair signs, the app makes a second file next to it:

- The chair's signature, typed or drawn, is stamped on the left part of the VP/Chairman line. At the right end of the line, above the event's name, the app prints the chair's name and the date ("Lillie Coit, 11/14/2026"), because the form has no date box for that line. That text takes at most 45% of the line; a longer name or event is cut short with an ellipsis (the date always shows), and a typed signature too long for the rest is shrunk and then cut short.
- A countersignature page goes after the requester's audit page. It lists:
  - the event and the chair's name
  - the address the link was sent to
  - when the link was sent and when it was used
  - the signature method (the IP address and browser it was signed from go in the Sheet, not on this page, because the requester gets this file)
  - the consent text
  - the SHA-256 of the requester-signed packet it countersigns
- The file is saved as `FY27-042-cosigned.pdf`, or `FY27-042-v2-cosigned.pdf` for a later version. Its SHA-256 goes in the Sheet and in the emails, the same as the requester's.

The requester-signed packet already prints the event's name in small type at the right end of the VP/Chairman line ("Event: Fun Run"), so that version says whose signature goes there.

**Where the chair's signature goes.** The packet isn't rebuilt to add the chair's signature. Rebuilding would need the requester's signature, and the app never stores it. Instead, when the app builds the packet, it records the page and position where the VP/Chairman line ended up and saves them in the request's JSON file (`FY27-042.json`, beside the PDF; `FY27-042-v2.json` for a later version). A fixed position won't work, because the line moves with the length of the expenditure list.

## Notifications

| Event | To | Content |
| --- | --- | --- |
| Requester signs, chair step applies | Each chair | The email described above, with the packet attached and the event budget line |
| | Requester | "Sent to the Fun Run chair to sign", with their signed packet attached. When `SEND_PACKETS_TO` is `requester`, it tells them not to forward this copy, because the co-signed packet will follow |
| Chair signs | AP or the requester, depending on `SEND_PACKETS_TO` | The usual packet email with the co-signed packet attached, the line "Signed by the Fun Run chair (lillie@example.com) on Nov 14", and the chair's note |
| | Requester, when packets go to AP | The usual copy, now co-signed |
| | The chair who signed | A short confirmation with the co-signed packet, for their records |
| Chair sends back | Requester | The note, who sent it back, and a link to fix the request. Replies go to that chair: the email holds no signing link |
| Requester taps Resend | Each chair listed now | The same email, subject starting "Reminder:", with a fresh link |
| 3 and 7 days with no action | Each chair | A reminder with a fresh link |
| 14 days with no action | AP or the requester, depending on `SEND_PACKETS_TO` | The usual packet email with the requester-signed packet and "The Fun Run chair did not sign within 14 days" |

## The requester's side

The request page shows *Waiting for the Fun Run chair to sign*, who the email reached and when, and a **Resend to the chair** button that works at most once a day. Until then it says when it can be used. If the email didn't reach a chair (at submission or on a resend), or the admin has added a chair since, the page says so and the button works at once, for those chairs only. The button can't send twice for one press. Resend sends to whoever the Events tab lists as chairs at that moment, so a chair the admin has just added gets it. Once the chair signs, the page shows who signed and when, and links the co-signed packet. *My requests* shows the same status in the list.

## Fixing a returned request

*Fix and re-sign* is one flow for every return: the chair's, a check signer's (see the *Mailed Check — Spec*), and AP's (Phase 2b, or a `Returned` status set by hand in the Sheet until then).

- The request page shows who sent it back and the note, and a **Fix and re-sign** button. It opens the form filled in from the request's JSON as that version was signed: the details, the event, the line items and their stipends, and the receipts, which stay in the request's folder and may be used again by that request only. The requester may change anything.
- The event the request already names may be kept even if it has been made inactive since. Any other event must be on the active list, as for a new request.
- Signing again makes the next version under the same request ID: `FY27-042-v2.pdf` and `FY27-042-v2.json` in the request's folder, beside the earlier files, which are never changed or deleted. The packet prints its version in the footer and on the audit page. The folder is the year in the request ID, so a version signed after July 1 stays beside the first.
- The row's `version` goes up, `pdf_file_id`, `pdf_sha256`, `request_file_id` and `submitted_at` move to the new version, `previous_pdf_file_ids` lists the earlier packets, and the request's own columns are rewritten from what was signed.
- The new version takes the same path a new request does, checked the same way. Every later step starts clean: the `chair_*`, `signers_*`, `signer_*`, account, FO10 and authorized-packet columns are cleared, and links from earlier versions show "This request was signed again since this link was sent."
- `returned_note`, `returned_by` and `returned_at` stay, recording the return the new version answers. The version's JSON keeps it too (`answers`, with who it came from), and the emails that carry the version say so: "Sent back by the Fun Run chair (lillie@example.com) on Nov 14, with this note: …". Subjects name the version ("FY27-042, version 2"), and the chair and check signer pages show it. The date is given only when `returned_at` was recorded after the version it returned was signed, since setting the status by hand in the Sheet leaves the earlier return's date in the cell.
- **What the chair is told.** The chairs see the note only when a chair sent the request back. A check signer's or AP's note may name the requester's home address or their stipends, which the chair never sees, so the chair's email and page say only that it was sent back by "one of the PTA's check signers" or "the PTA's accounts payable team". AP, the requester and the check signers get the note as written.
- A version signed again after June 30 still counts toward the fiscal year in its ID, so its stipends are checked and reported with that year's requests.
- Re-signing takes the row's lock and checks the row is still *Returned* at the version the form was filled from, so a double press or a second tab makes one version, not two.

## Data changes

**Requests tab.** New columns are appended to the header on first use, like every column the app has gained:

| Column | Meaning |
| --- | --- |
| `event` | The event's name, as chosen on the form |
| `chair_step` | Blank, Waiting, Signed, Sent back, Skipped: requester is a chair, Skipped: no chair listed, or Timed out |
| `chair_sent_to` | The addresses the chair email reached. A chair whose email failed isn't listed until a resend reaches them |
| `chair_sent_at` | When the email last went out, at submit or on resend |
| `chair_signed_by` | The address that signed |
| `chair_name` | The name the chair signed under |
| `chair_signed_at` | When the chair signed |
| `chair_note` | The chair's note to AP |
| `chair_ip`, `chair_user_agent` | The IP address and browser the chair signed from. Kept here for AP rather than on the countersignature page, which the requester gets |
| `chair_pdf_file_id`, `chair_pdf_sha256` | The co-signed packet and its hash |
| `request_file_id` | The request's JSON file (`FY27-042.json`), written for every request. Phase 2 calls it `request.json` |
| `lock` | Held for a few seconds while the app signs or resends, so two of them at once can't both go through: the lock's expiry and a random ID. Blank otherwise. One left behind by a crash expires after 3 minutes, and is safe to clear by hand |

Step 2 adds three of Phase 2's columns early, appended the same way:

| Column | Meaning |
| --- | --- |
| `returned_at`, `returned_by` | When the request was last sent back, and the address of the chair, check signer or AP member who did it. `returned_note` says why. All three stay after the requester re-signs |
| `previous_pdf_file_ids` | The requester-signed packets of earlier versions, oldest first. `pdf_file_id` is the current version's |

`pdf_file_id` and `pdf_sha256` still mean the requester-signed packet. Wherever the app links a packet (the request page, and the Phase 2 dashboard), it uses the co-signed one when there is one. `RequestStatus` gains *Awaiting chair*.

**New tab:** Events, with the columns above.

**Drive:** every request's folder now holds its JSON file. Event requests also get the co-signed PDF once the chair signs. Nothing is deleted.

## How this fits with Phase 2

- **Status model.** Phase 2's status table gains *Awaiting chair* before *Submitted*. "Returned → Submitted" becomes "Returned → Awaiting chair" when the chair step applies.
- **Dashboard.** Requests awaiting the chair haven't reached AP yet, so the default view leaves them out. The status filter can show them, so AP can see what's coming and chase a slow chair. For a Submitted request, the age counts from when it was sent on, not from when the requester signed.
- **Resubmission.** The *Fix and re-sign* flow is the same build Phase 2b describes, and whichever ships first builds it. Step 1 already writes every request's JSON file, so every request submitted from then on can be refilled.
- **Weekly digest.** Adds a section for requests that have been awaiting the chair for more than 7 days.
- **Actions tab.** Once it exists, each chair signature, send-back, resend and time-out adds a row.
- **The VP/Chairman question.** Both earlier specs leave open what happens to the VP/Chairman line (Phase 2 open question 11). This stage answers it for event requests. Other requests keep the line blank.

## Security and privacy

- The chair link is a signed token naming the chair's address, the request and its version. The app checks it against the request's row and the Events tab every time it's used. As with the sign-in and approval links, anyone who has the email can use the link. The countersignature page records which address it was sent to. So that the requester never ends up holding a chair's link, the chair email's Reply-To is AP, and chairs are asked to write to the requester in a new email rather than reply or forward.
- The chair's IP address and browser are recorded in the Sheet, which only AP and the admin see, and not on the countersignature page, because the requester gets the co-signed file. (The requester's own IP address and browser stay on their audit page, as before.)
- Opening the link does nothing. Signing needs a separate button press after the page has loaded.
- The chair sees only that one request: its summary and its packet, including the receipts. They can't see the requester's other requests or any stipend balances. The event budget shows only totals, never who claimed what. The existing tip to crop personal details out of receipts applies here too.
- The chair page sends no Referer header and asks search engines not to index it, because the token is in its URL.
- Chair links go only to addresses in the Events tab, which only the admin and AP can edit.
- The cron route that sends reminders and times out requests is protected by `CRON_SECRET`, as in Phase 2.

## Rollout

1. **Sign.** *Built Nov 12, 2026.*
   - The Events tab and the event question, with the guess from the description.
   - The event budget on the chair page and in the chair email.
   - The *Awaiting chair* status.
   - The chair email, and the chair page with **Sign**.
   - The co-signed packet, and sending it on.
   - The requester's status line and the Resend button.
   - The request's JSON file written on every submit.
   - Updated help guides, including a short page for chairs that their email links to.

2. **Send back.** *Built Nov 19, 2026.*
   - The chair's **Send back** button, under the row lock, and the email to the requester.
   - The requester's *Fix and re-sign* flow, with versions (see *Fixing a returned request*). It is the one Phase 2b and the Mailed Check spec's step 2 describe, so a request a check signer sent back, or one AP returned, is fixed the same way.
   - The chair email now asks a chair who finds a problem to send it back.
   - Updated help guides: sending back in the chairs' and check signers' guides, and a question on fixing a sent-back request in the teacher and volunteer guides.
3. **Nudge.** A daily Vercel cron job that sends the 3-day and 7-day reminders and handles the 14-day time-out. The same route can later run the Phase 2c digest and the 30-day cleanup of `pending/`.

**Pilot.** Pilot step 1 with the Fun Run: add it to the Events tab, with its budget, and send a couple of real requests through.

**Order.** Build this stage before Phase 2. It changes what *Submitted* means, and the dashboard is easier to build once the status model is final. Phase 2a only reads the Sheet, so it can be built at the same time.

**Success measures.** The share of event requests that reach AP with the chair's signature, and the number of days from the requester's signature to the chair's.

## Open questions

None. The defaults proposed in v0.1 were accepted and are listed under *Decisions*.

## Changes since v0.2

- Step 2 is built: the chair's **Send back**, and *Fix and re-sign* with versions, shared with the check signers' send-back and AP's returns. A new section, *Fixing a returned request*, describes it.
- Settled while building it: the chair gives only a note, not a name; replies to the sent-back email go to that chair; a returned request may keep an event made inactive since; every version's packet prints its version; the emails carry the return note each version answers.
- `returned_at`, `returned_by` and `previous_pdf_file_ids` are added now rather than with Phase 2.
- From a code review of the build: the chair is shown the note a version answers only when a chair wrote it; a return's date is given only when it belongs to the version returned; a version's stipends count in its ID's fiscal year; the check signer page shows the version and its note; the FO10 attachments, the chair's "Signed" email, the signer's receipt and the countersignature page name the version.

## Changes since v0.1

- Event budgets: an optional `budget` column in the Events tab. The chair page and the chair email show what's left of it before and after the request, counted like the stipends; going over is a warning, never a block.
- The defaults in v0.1's open questions were accepted and moved to *Decisions*.
- Layout of the chair line settled: signature on the left, the chair's name and date above the event's name at the right end.
- The request's JSON file is named after the request (`FY27-042.json`).
- Step 1 is built.
