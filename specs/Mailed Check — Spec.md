# Mailed Check — Spec

Nov 19, 2026 · Draft v0.7 · Companion to the *Teacher Reimbursement Portal — Product Spec* (v0.4), the *Phase 2 — AP Workflow Spec* and the *Event Chair Signature — Spec*, which stay the source of truth for what they decide.

## Overview

Requesters can get their check in two ways today: in their staff mailbox, or by arranging pickup with the PTA. Mailing the check was a choice at launch, and pickup replaced it.

This stage brings mailing back. The PTA doesn't write these checks by hand and post them. Its bank's bill pay service mails them. CAPTA treats bill pay as an electronic payment. Its rules say every such payment needs an *Authorization for Payment via Electronic Services* form (FO10), signed by two authorized check signers before the payment is set up, with the invoices and the signed request for payment attached.

When a requester chooses **Mail it to me**, they enter a mailing address and sign as usual. The app fills in the FO10 from what the request already says and emails each of the PTA's check signers a link of their own. Two different signers open the request, check it, and sign the FO10's two *Authorized By* lines. The app then puts the FO10 in front of the signed packet and sends the whole thing straight to AP, who sets up the bill pay payment.

Staff mailbox and pickup requests work exactly as they do today.

Mailing is switched on one account at a time at first, through a new column in the Users tab, so the PTA can try it with a few people before offering it to everyone.

**Defaults.** Choices marked *(default)* are proposals. Each is listed again under *Open questions*, and the build follows the default unless it is changed there.

## Decisions

| Topic | Decision |
| --- | --- |
| How a mailed check is sent | Through the bank's bill pay. AP sets up the payment at the bank, and nobody writes the check by hand |
| Who can choose mail | During the pilot, only requesters whose Users row has `mailed_checks` set to `yes`. Later everyone, once `MAILED_CHECKS` is set to `everyone`, except accounts set to `no` |
| When the check signers sign | After the requester, and after the chair for an event request. Before the packet goes to AP |
| How the signers are reached | Each address in `CHECK_SIGNERS` gets its own email and link. Any two of them may sign |
| Telling the two signers apart | By the address each link was sent to. The two addresses must differ, and neither may be the requester's |
| Where the authorized packet goes | Always straight to AP, with a copy to the requester, whatever `SEND_PACKETS_TO` says |
| Replies to signer emails | Go to AP, never to the requester |
| Budget Account and Payment Account | Filled in by the app. The first signer can correct the Budget Account and picks the Payment Account from a set list. After that, both are locked |
| How a signer signs | Through their own link in the email, tied to that one request. No account or sign-in |
| Electronic signatures on the FO10 | Accepted by the treasurer. The signers sign the same way the requester does |
| Settings | Environment variables: `CHECK_SIGNERS`, `BILL_PAY_ACCOUNTS` and `MAILED_CHECKS`. Per account: the `mailed_checks` column in the Users tab |

## What CAPTA requires

The rules are on the CAPTA toolkit page *Payment via Electronic Funds Transfer/Bank Bill Pay Services*. The form is FO10 (revised 07/2022, in the November 2024 toolkit), and a copy is in `specs/AuthorizationforPaymentviaElectronicServices-FO10.pdf`.

| Rule | In the portal |
| --- | --- |
| An FO10 for every EFT, ACH or bill pay payment | The app fills one in for every mailed-check request |
| Signed by two authorized check signers | Two different signers, each through a link sent to their own address |
| Signed before any transfer is initiated | AP gets the packet only after both have signed |
| Attach all invoices and the original signed request for payment | The FO10 is the first page of a packet that holds the signed reimbursement form and every receipt |
| Signatures by facsimile copy are accepted | The signers sign electronically, the same way the requester does, with an authorization page. The treasurer accepts electronic signatures on the FO10 |
| A separate bank account for online payments is advisable. Money moves into it on an *Authorization to Transfer Funds Between Accounts* form | Outside the portal: the treasurer's bank setup |
| Every expense appears in the monthly treasurer's report | Outside the portal, as today |
| Cyber liability insurance is recommended | Outside the portal |

## Goals and non-goals

**Goals**

- A requester can have their check mailed by choosing it and typing an address. Everything else on the FO10 comes from what they've already entered, and the address is remembered for next time.
- Every mailed-check request reaches AP with an FO10 signed by two check signers, in front of the signed request and its receipts. Nobody prints, fills in, scans or forwards the FO10.
- The two signatures come from two different check signers' own addresses, neither of them the requester's. One person can't make both.
- AP pays only to the address and amount the signers saw.
- A check signer can review and sign on a phone, starting from the email, in under two minutes and without an account.
- The requester can always see whose signature the request is waiting for.
- Staff mailbox and pickup requests go through exactly as they do today.
- The PTA can offer mailing to a few accounts first and to everyone later, without a code change.

**Non-goals**

- Paying through the bank from the app. AP still sets up each bill pay payment at the bank, and the app doesn't connect to the bank.
- Direct deposit to the requester's bank account. The FO10 also covers ACH and EFT, but the app still stores no bank or card numbers.
- Paying a vendor's invoice directly. The FO10 is written for vendors and could be used that way in a later stage. This stage pays requesters only.
- Stopping two check signers who work together. Any two-signer rule assumes the two are independent.
- The FO10's *For PTA treasurer use* block, which stays blank, as it does on the reimbursement form.
- The other CAPTA rules for electronic payments, listed above as outside the portal.

## Who is involved

| Role | How they get it | What they do |
| --- | --- | --- |
| Requester | The Users tab, as today | Chooses *Mail it to me* when mailing is switched on for their account, enters the address and signs. Sees who the request is waiting for, and can resend the signer emails |
| Event chair | The Events tab, as in the chair spec | Signs first when the request is for an event, as in the chair spec |
| Check signer | Listed in `CHECK_SIGNERS`. No Users row or sign-in needed | Opens the request from their own emailed link, then signs an *Authorized By* line or sends the request back with a note. The first to sign also confirms the Budget Account and picks the Payment Account |
| AP | As today | Gets the packet once two signers have signed, and sets up the bill pay payment |
| Admin | Sets the `CHECK_SIGNERS`, `BILL_PAY_ACCOUNTS` and `MAILED_CHECKS` environment variables, and the `mailed_checks` column in the Users tab | Keeps `CHECK_SIGNERS` matching the board's check signers, usually each fiscal year. During the pilot, switches mailing on one account at a time. A change to an environment variable takes effect at the next deploy. A change to `mailed_checks` takes effect the next time that requester opens or signs a request |

Being listed in `CHECK_SIGNERS` is the approval. The board's check signers share an email alias, but the app doesn't use it. A link sent to an alias can't tell the app which person signed, and one person could sign twice under two names.

## The form

*How should you get the check?* gains a third choice, **Mail it to me**, after *Leave it in my staff mailbox* and *Arrange pickup with the PTA*. Choosing it shows two fields and a line of help.

| Field | Example | Rules |
| --- | --- | --- |
| Street address | 123 Main St Apt 4 | Required. One line of up to 40 characters: letters, numbers, spaces and `. , # - / '` |
| City, state and ZIP | San Francisco, CA 94127 | Required. The same characters, up to 40. Must end in a 5-digit ZIP or a ZIP+4 |

The app refuses longer text rather than shrinking it. That way the FO10 prints exactly what the emails say, and characters that look alike can't differ between the two.

The help line reads: "Mailed checks take a few extra days. Two PTA check signers approve the payment first, then the PTA's bank mails it."

**Filled in for next time.** The choice starts on whatever the requester used last, as today, and *Mail it to me* now counts as one of those choices. The address comes from the requester's most recent mailed request, even when their last request used the mailbox, so switching back to mail doesn't mean typing it again. Rows from before pickup replaced mailing already say `mail` and have an address, and they count too. The address is saved in the draft along with the rest of the form.

**Who is offered mailing.** Mailing is switched on account by account, so it can be tried with a few people first. The Users tab gains a `mailed_checks` column:

| `mailed_checks` | Mailing for that account |
| --- | --- |
| `yes` | Offered |
| `no` | Not offered |
| Blank, or anything else | Follows `MAILED_CHECKS`. Not offered while it's `pilot`, which is the default, and offered once it's `everyone` |

`MAILED_CHECKS` set to `off` hides mailing from every account, whatever its cell says. Case doesn't matter. The admin sets the column in the Sheet, and the approval page doesn't show it, so a newly approved account starts blank.

**When mailing isn't offered.** The choice is hidden for an account that mailing isn't switched on for. It's also hidden for everyone while `CHECK_SIGNERS` or `BILL_PAY_ACCOUNTS` isn't set, and for a requester who is a check signer when fewer than two other signers are listed. The server refuses a mailed request in each of these cases, so hiding the choice isn't the only guard.

The app reads the account's row when the form opens and again when the requester signs. Switching mailing off for an account doesn't affect a request that's already with the check signers, which carries on to AP. If a draft chose *Mail it to me* and mailing has since been switched off, the form asks the requester to choose again, as it does for an event that has come off the list, and the draft keeps the address. While mailing is off for an account, its earlier `mail` rows start the choice on pickup, as they do today.

**The reimbursement form.** The PTA's reimbursement form has *Address* and *City/Zip* boxes. For a mailed check the app leaves them blank and prints "Check: Mail (address on the FO10)" in the margin. The FO10 carries the address. The event chair, who is often a parent using a personal address and keeps the email, never sees the requester's home address.

**Before signing.** The preview step says what happens after signing:

- Mailed: "After you sign, two of the PTA's check signers approve the payment. Then the PTA's bank mails your check to 123 Main St Apt 4, San Francisco, CA 94127."
- Mailed, for an event: "After you sign, this goes to the Fun Run chair to sign, then to two of the PTA's check signers. Then the PTA's bank mails your check to 123 Main St Apt 4, San Francisco, CA 94127."
- Mailbox or pickup: the same text as today.

The requester doesn't see or sign the FO10. It has no line for them, and everything on it comes from what they've already entered.

## The FO10

The app keeps its own copy of the FO10 at `assets/fo10-template.pdf`. As with the reimbursement form, it's the official PDF with its fields renamed, because the original names are strings like `KLMNOIPK` and `fill_19`. The copy also removes the stray fields that sit above the footer (`undefined` and `fill_23` to `fill_30`) and the one above the treasurer heading (`ƒ//ƒ‹`). Nothing else is changed. The app fills the copy through its fields and flattens it.

The requester's details on the FO10 come from the request's `request.json`, never from the Requests row, which AP and the admin can edit. Before using `request.json`, the app checks that the packet hash it records matches the row's `pdf_sha256`.

| FO10 line | Original field | Renamed to | Filled with |
| --- | --- | --- | --- |
| Date | `K` | `date` | The date the requester signed |
| Vendor Name | `KLMNOIPK` | `vendor_name` | The payee's name |
| Address | `K Q` | `address` | The street address |
| City/State/Zip | `V` | `city_state_zip` | The city, state and ZIP |
| Telephone (area code) | `Text5` | `phone_area_code` | The area code, split as on the reimbursement form |
| Telephone (number) | `Z` | `phone_number` | The rest of the number |
| Email | `W` | `email` | The requester's sign-in address |
| Budget Account | `MKJ5 NLJ` | `budget_account` | See below. The first signer confirms it |
| Reason for Payment | `NOFISPKLJ` | `reason` | The request ID and the purpose: "Reimbursement FY27-042: Classroom supplies" |
| Payment Account | `FISPKLJ5 NLJ` | `payment_account` | The first entry in `BILL_PAY_ACCOUNTS`. The first signer picks from the list |
| Payment Amount | `FISPKLJ5PNLJ` | `payment_amount` | The reimbursement claimed, after any donation to the PTA: "$123.45" |
| Requested By | `KMS` | `requested_by` | The payee's name and PTA position: "Harvey Milk, 2nd grade teacher" |
| Authorized By, first | `aKMS` | `signer_1_signature` | Stamped when the first signer signs |
| Date, first | `K_2` | `signer_1_date` | The date the first signer signed |
| Authorized By, second | `aKMS_2` | `signer_2_signature` | Stamped when the second signer signs |
| Date, second | `K_3` | `signer_2_date` | The date the second signer signed |
| *For PTA treasurer use* | `Check Box6` to `8`, `fill_19` to `22`, `Text1` to `4` | `treasurer_…` | Never filled |

**Budget Account.** The app starts from what the request already says about where the money comes from:

1. The stipend it's paid from, named as in the `funding` cell ("Grade 2 stipend"). A request split between stipends lists each one: "Classroom stipend; Grade 2 stipend".
2. If no stipend pays for it, the event it's for ("Fun Run").
3. Otherwise blank, and the first signer fills it in.

The first signer can change it. It's required, up to 60 characters, with the same character rules as the address, plus `;`, `&`, `(` and `)`. The value the app fills in is made to fit those rules: curly quotes and dashes become plain ones, accents come off, other characters become spaces, and it's cut to 60 characters. A first signer who leaves it as it is can always sign.

**Payment Account.** This is the PTA account the payment comes from. The first signer picks it from `BILL_PAY_ACCOUNTS`, and it starts on the first entry. Each entry is a nickname or the last four digits, such as "Bill pay checking ••1234", and never a full account number. With only one entry, there's nothing to pick.

Once the first signer has signed, both values are locked, so the second signer signs exactly what the first signed.

## When the signer step applies

| The request | What happens | `signers_step` |
| --- | --- | --- |
| Staff mailbox or pickup | Goes on as today | blank |
| Mailed, not for an event | Status becomes *Awaiting signers*, and every check signer except the requester gets their own email | Waiting |
| Mailed, for an event | The chair step runs first. When it ends (signed, skipped or timed out), the request becomes *Awaiting signers* | blank, then Waiting |
| Mailing switched off (see *The form*) | The form doesn't offer it, and the server refuses it | — |

The signer step is never skipped. A requester who is also a check signer isn't emailed for their own request, can't sign it, and still needs two other signers.

**Straight to AP.** Once both have signed, the authorized packet goes to `AP_EMAIL`, with a copy to the requester. This ignores `SEND_PACKETS_TO`. A packet that passed through the requester's hands could be edited before it reached AP. AP sets up bill pay only from the app's own email or the copy in Drive, never from a forwarded one.

## Status model

This stage adds one status, after *Awaiting chair* and before *Submitted*.

| Status | Meaning | Set by |
| --- | --- | --- |
| Awaiting signers | The requester (and the chair, if any) have signed, and the request is waiting for one or both check signers | The app, for a mailed request, on submit or when the chair step ends |
| Submitted | Sent to AP, with the FO10 signed by two signers. Same meaning as before | The app, when the second signer signs |
| Returned | Needs a change, and the note says what | A check signer, by sending it back. The chair and AP can also return a request, as before |

**New transitions**

| From | To | Who | Notes |
| --- | --- | --- | --- |
| (signing) | Awaiting signers | The requester, by signing a mailed request that has no chair step | |
| Awaiting chair | Awaiting signers | The chair, by signing, or the app, when the chair step times out | For a mailed request, the chair spec's time-out sends the request to the signers, not to AP |
| Awaiting signers | Awaiting signers | The first signer, by signing | `signers_step` becomes *1 of 2 signed* |
| Awaiting signers | Submitted | The second signer, by signing | The authorized packet goes to AP |
| Awaiting signers | Returned | Either signer, by sending it back | Note required. Every signer link stops working |
| Returned | Awaiting chair or Awaiting signers | The requester, by re-signing | Built in rollout step 2. A new version needs both signatures again, even if one signer had signed the old one *(default)* |

**A new version starts clean.** Re-signing clears every signer column, `budget_account`, `payment_account`, and the FO10 file IDs and hashes, and the new version gets a new FO10. Signatures and files from the old version stay in the Signatures tab and in Drive, but nothing from them carries over.

**No time-out.** The bank can't pay without the FO10, so a request awaiting the signers never goes on unsigned. The signers get reminders, the requester can resend, and the weekly digest lists it *(default)*.

A request awaiting the signers counts against its stipend, the same as a submitted one.

## The signers' email and page

**The email** goes to each address in `CHECK_SIGNERS` except the requester's, one message per signer, each with that signer's own link. Replies go to `AP_EMAIL`. They never go to the requester, because a reply quotes the link.

- Subject: "Please authorize: mailed check to Harvey Milk, $123.45 (FY27-042)". After the first signature it's "One more signature: mailed check to Harvey Milk, $123.45 (FY27-042)".
- The body gives the requester's name and position, the purpose, the line items, the totals, the mailing address, the Budget Account and the Payment Account, and any of the flags below. For an event request, it names the chair who signed. After the first signature, it names the first signer.
- It has a **Review and sign** button.
- Attached are the packet as it stands (requester-signed or co-signed) and the FO10 as filled in so far.
- It says nothing about stipends beyond the Budget Account.

**Worth a second look.** The signer page and every email to the signers and AP show these flags when they apply:

- No mailed check has gone through for this account before.
- The address differs from the last mailed check that went through for this account.
- The payee name differs from the one on this account's earlier requests that went through.

An account that has been taken over is worth more once a check can be mailed to any address, and these are the signs of it.

Only the account's requests that went through count: approved or paid by AP, or authorized by two check signers. A request that was sent back, or is still waiting, doesn't count. Otherwise a try that a signer sent back, or one still waiting, would make the next one look like the account's usual.

**The page** at `/signers/FY27-042?t=…` shows the same summary and flags, the FO10, and the packet with its receipts. It offers two choices:

- **Sign.** The first signer can change the Budget Account and pick the Payment Account. The second signer sees both locked, with the first signer's signature already on the FO10. Each signer types their name, ticks "I agree to sign electronically", then signs by keeping the typed name or drawing a signature. This is the same signing step the requester and the chair use. They can add an optional note to AP, which goes into the packet email.
- **Send back.** A note is required. The request becomes *Returned*, the requester and AP get the note by email, and every signer link stops working. The requester fixes it with *Fix and re-sign*, and the new version needs both signatures again.

**Checks on every visit.** Each time the page opens or a signer presses a button, the app re-reads the request's row and checks that:

- the link's address is still in `CHECK_SIGNERS`, so removing someone and redeploying stops their links at once
- the address isn't the requester's
- the request ID matches the page, and the version matches the row
- the request is still awaiting the signers
- for the second signature, the address isn't the first signer's: "You've already signed this one. The second signature has to come from a different check signer." The first signer is taken from the first signature's row in the Signatures tab, not from `signer_1_email`, which can be edited. This is checked again under the lock.

The typed name also mustn't match the payee's name, ignoring case, spacing and punctuation: "You can't authorize a payment to yourself."

**One link, either signature.** A signer's link works for whichever signature comes next, unless they've already signed.

**How long the link works.** 14 days *(default)*, for that one signer, request and version.

**Link scanners.** Opening the link only shows the page, and nothing happens until a signer presses a button. Email security scanners that open links therefore can't sign anything.

**After it's done.** Once the request has left *Awaiting signers*, every link shows only a status line, such as "Authorized by Lillie Coit and Joshua Norton on Nov 15" or "Sent back by Lillie Coit on Nov 14". It no longer shows the packet, the address or the receipts.

## How a signature is recorded

The Sheet can't update a cell only if nobody else has changed it, and today the app rewrites whole rows. Without more care, two signers pressing **Sign** at once could both be recorded as the first, or both as the second, and AP could get two authorized packets and pay twice. Signing uses the same row lock as the chair's signature and every resend (`lock.ts`), so one step runs on a request at a time, whichever kind it is.

1. The page sends back what it showed: the version and which signature (first or second) the signer is making.
2. The server checks the token and the row as above, then takes the request's row lock. If another signer, a send-back or a resend holds it, the page says someone is working on the request and offers a reload.
3. Under the lock, it reads the row again and stops if it no longer waits for that signature. Then it builds the files, adds the signature's row to the **Signatures** tab, and marks the Requests row in the same write that releases the lock.
4. Only then does it send the emails. AP's email goes from the row as the lock wrote it, with nothing read in between. Anything that stops that email, a failed Sheets read as much as a failed send, is recorded in `authorized_send_error`, so the requester is offered **Send it to the PTA** rather than left waiting.

A lock left by a crash expires after 3 minutes, and the next press can take it. A failure before the Requests row is written leaves the row as it was. It may leave a file in Drive or a Signatures row behind, but neither matches the FO10 hash on the row, so nothing reads them.

**The Signatures tab** keeps one row per signature or send-back, added under the lock and never changed. It holds what the Requests tab and the packet leave out: the signer's IP address and browser, and the accounts as the first signer locked them. The second signature, its emails, the authorization page and AP's email take the accounts from the first signature's row, found by the FO10 hash the Requests row records, not from the Requests row, which AP can edit. No step depends on the order of rows in the tab.

Every write this feature makes to the Requests tab updates only its own cells, not the whole row. Today `SheetTable.update` rewrites the row, so it needs a cell-level update. That way a resend, a reminder, a signature and AP editing another column of the same row can't overwrite each other. The same goes for the Users tab: signing in and deciding access write only their own cells, so they can't undo an admin's `mailed_checks` change made at the same moment.

## The FO10 and the authorized packet

The requester-signed packet and the chair's co-signed packet are never changed. The FO10 has no requester signature on it, so the app can fill it in fresh whenever it needs to. It makes two new files.

**After the first signature**, it saves `FY27-042-fo10-1.pdf` and records its SHA-256 in `fo10_sha256`. This is the FO10 filled in from `request.json` and the confirmed accounts. The first signer's signature, typed or drawn, is stamped on the first *Authorized By* line, and the date goes in that line's *Date* box. The signer's name is printed small at the right end of the line, because the form has no box for it.

**After the second signature**, the app checks `FY27-042-fo10-1.pdf` against `fo10_sha256`. It also checks the packet against `chair_pdf_sha256` or `pdf_sha256`, and stops if either one differs. It stamps the second line on a copy of the FO10. It doesn't store the first signature separately, just as it never stores the requester's. Then it makes `FY27-042-authorized.pdf`, which holds:

1. The signed FO10.
2. Every page of the packet the signers authorized, unchanged. That's the co-signed packet when the chair signed, and otherwise the requester-signed one.
3. An authorization page at the end, listing:
   - the payee, mailing address, payment amount, Budget Account and Payment Account, as text
   - what the app filled the Budget Account with, if the first signer changed it
   - for each signer, their name, the address their link was sent to, when it was sent and when it was used, and the signature method
   - the consent text
   - the SHA-256 of the packet they authorized, and of the first-signature FO10

The requester gets a copy of the packet, so this page leaves some things out. The signers' IP addresses and browsers go in the Signatures tab. Their notes and the flags go to AP in the packet email. The flags are the PTA's checks for a stolen account, and whoever holds that account shouldn't learn them.

A later version is saved as `FY27-042-v2-fo10-1.pdf` and `FY27-042-v2-authorized.pdf`. The authorized packet's SHA-256 goes in the Sheet and in the emails, the same as the requester's.

**Where the signatures go.** The FO10 is always one page and its lines never move, so the app uses the positions of the template's fields. This is unlike the VP/Chairman line, whose position depends on the packet.

## Paying the right address

Getting a payment sent to a different address is the usual way to steal one. The rules:

- AP pays only to the address and amount on the signed FO10.
- Any change to either one is a new version: *Fix and re-sign*, and both signatures again. AP doesn't act on a change of address sent by email.
- The packet email to AP says: "Pay only to the address on the signed FO10. A change of address needs a new request."
- The AP email, the Phase 2 dashboard and the Paid email take the address and amount from `request.json`, not the row. The dashboard shows a warning when the row's `address`, `city_zip` or amount differs from it.

## Notifications

| Event | To | Content |
| --- | --- | --- |
| A mailed request reaches the signer step | Each check signer except the requester | The email described above, with their own link |
| | Requester, when the request had no chair step | "Sent to the PTA's check signers", with their signed packet attached. It says the PTA gets the authorized packet directly and they'll get a copy. When the request had a chair step, the chair spec's email at submit already says the signers come next, so this one isn't sent |
| A signer signs | That signer, at their own address | A receipt: the name they signed under, the payee, the amount and the address, and "If this wasn't you, tell the PTA at ap@miralomasf.com" |
| First signer signs | Every other check signer except the requester | "One more signature needed", naming the first signer, with a fresh link and the FO10 carrying the first signature |
| Second signer signs | AP, always | The usual packet email with the authorized packet attached. It adds "Mail the check to: 123 Main St Apt 4, San Francisco, CA 94127", "Authorized by Lillie Coit (Nov 14) and Joshua Norton (Nov 15)", the Budget Account and Payment Account, the flags, each signer's note, and the line about paying only to the address on the FO10 |
| | Requester | The usual copy, now with the FO10 |
| A signer sends it back | Requester and AP | The note, who sent it back, and what to do next |
| 3 and 7 days with no signature | Each check signer who hasn't signed, except the requester | A reminder with a fresh link, saying how many signatures are still needed *(default)* |

## The requester's side

The request page shows *Waiting for the PTA's check signers*, and then *One of two check signers has signed*. It shows when the emails went out, and it has a **Resend to the check signers** button that works at most once a day. Once both have signed, the page shows who signed and when, and says "The PTA's bank will mail your check to 123 Main St Apt 4, San Francisco, CA 94127." *My requests* shows the same status in the list. The page links the authorized packet only once AP has it, after checking it against its hash. Until then, the link is to the packet as the requester or chair signed it, so the requester never holds an authorized packet that AP doesn't.

If the authorized packet's email to AP fails, the page doesn't say it went. It says AP doesn't have it yet and offers **Send it to the PTA**. That sends the saved packet from Drive to AP, after checking it against its hash, so the requester never carries it. Then it sends the requester's copy. The copy goes only once AP has the packet, so it didn't go the first time. The recorded failure is cleared before the send. If the send then goes but can't be recorded, the page says the packet is on its way, and the button doesn't come back to send AP a second copy. The button shows only once the failure is recorded, never because of how long it has been. A send that went through but whose time couldn't be recorded must not lead to a second packet. Until the email is recorded as sent or failed, the page says the packet is on its way and that a copy will arrive by email, and asks the requester to contact the PTA if it hasn't come by the next day.

## Data changes

**Requests tab.** Three existing columns come back into use:

| Column | Meaning |
| --- | --- |
| `check_delivery` | `mail` again, alongside `mailbox` and `pickup` |
| `address` | The street address, for display. `request.json` is what the FO10 and AP use |
| `city_zip` | The city, state and ZIP, for display. The header keeps its old name, because renaming a header breaks the app's lookups |

New columns are appended to the header on first use, like every column the app has gained:

| Column | Meaning |
| --- | --- |
| `signers_step` | Blank, Waiting, 1 of 2 signed, Signed, or Sent back |
| `signers_sent_to` | The addresses the signer emails went to |
| `signers_sent_at` | When they last went out: at the start, after the first signature, or on resend |
| `signer_1_email`, `signer_1_name`, `signer_1_signed_at`, `signer_1_note` | The first signer |
| `signer_2_email`, `signer_2_name`, `signer_2_signed_at`, `signer_2_note` | The second signer |
| `budget_account`, `payment_account` | The values on the signed FO10 |
| `fo10_file_id`, `fo10_sha256` | The FO10 with the first signature, and its hash |
| `authorized_pdf_file_id`, `authorized_pdf_sha256` | The authorized packet and its hash |
| `authorized_sent_at` | When the authorized packet's email reached AP. Blank until it does |
| `authorized_send_error` | Why the last try to email AP the authorized packet failed. Blank otherwise. Only then is **Send it to the PTA** offered |

Wherever the app links a packet, it uses the authorized one if there is one, then the co-signed one, then the requester-signed one. `RequestStatus` gains *Awaiting signers*.

**New tab: Signatures.** One row per signature or send-back, added and never rewritten. The columns are `record_id`, `request_id`, `version`, `slot` (1 or 2), `signer_email`, `signer_name`, `state` (signed or sent back), `signed_at`, `method`, `ip`, `browser`, `link_sent_at`, `budget_account`, `payment_account`, `packet_sha256` and `fo10_sha256`.

**Users tab.** One new column, `mailed_checks`, appended to the header on first use: `yes`, `no` or blank, as in *Who is offered mailing*.

**`request.json`** records the SHA-256 of the packet it was signed into, so the app can tell that it belongs to that packet.

**Environment variables.** Read in `config.ts` like `AP_EMAIL`, and listed in `.env.example` and the README.

| Variable | Meaning |
| --- | --- |
| `CHECK_SIGNERS` | The check signers' own addresses, separated by commas. Mailing is offered only when this and `BILL_PAY_ACCOUNTS` are both set |
| `BILL_PAY_ACCOUNTS` | The PTA accounts bill pay can draw from, separated by commas, as nicknames or last four digits ("Bill pay checking ••1234"). The first is the default |
| `MAILED_CHECKS` | `off`, `pilot` or `everyone`. Unset is `pilot`: only accounts set to `yes` are offered mailing. `everyone` offers it to every account not set to `no`. `off` offers it to nobody, whatever the cells say |

As with `ADAPTERS`, a bad value must not slip through quietly. The app refuses to start if `CHECK_SIGNERS` has an entry that isn't an address, has the same address twice, or includes `AP_EMAIL`, `APPROVER_EMAIL` or `FROM_EMAIL`. Those are shared mailboxes, and a link sent to one could be used by anyone who reads it. It also refuses to start if `MAILED_CHECKS` is set to anything but `off`, `pilot` or `everyone`. The signer link's 14 days and the once-a-day resend are constants beside the chair's in `config.ts`, not environment variables.

**Drive:** a request's folder may also hold the FO10 and the authorized packet. Nothing is deleted.

**Assets:** `assets/fo10-template.pdf`. CAPTA's original stays in `specs/`.

## How this fits with the chair step and Phase 2

- **Order.** Requester, then chair, then check signers, then AP. Each step adds a file and changes nothing before it.
- **Shared parts.** The signer page reuses the chair page's signing step and token checks, and the request's `request.json`. The reminders run on the chair step's daily cron job. Signing takes the chair step's row lock, so signatures, send-backs and resends on one request never overlap. The Signatures tab and the cell-level writes are new. Build this after step 1 of the chair spec.
- **Changes the chair spec should take.** The same review found two of these problems in the chair step:
  - The chair email's Reply-To should be AP, not the requester, because a reply hands the requester a working chair link.
  - The chair's IP address and browser should be kept off the countersignature page, which the requester receives.
- **`SEND_PACKETS_TO`.** Mailed requests ignore it and always go straight to AP. Mailbox and pickup requests still follow it.
- **Chair time-out.** A mailed event request that times out at the chair goes to the signers, not to AP. The signers' email and page say that the chair didn't sign.
- **Status model.** Phase 2's status table gains *Awaiting signers* after *Awaiting chair*. "Returned → Submitted" becomes "Returned → Awaiting signers" for a mailed request.
- **Dashboard.** Requests awaiting the signers haven't reached AP yet, so the default view leaves them out. The status filter can show them. Mailed requests show *Mail* in the list, the address from `request.json`, and a warning if the row differs from it.
- **Paying a mailed request.** Both signatures are already on the FO10, so Phase 2's *Check written* step, which covers the wait for a second signature on a paper check, doesn't apply. For mailed requests, AP's **Record check** becomes **Record bill pay**. It asks for the date the payment was set up and the confirmation or check number from the bank, and it can mark the request Paid in the same step. It refuses a second payment for the same request. The Paid email says "Mailed to 123 Main St Apt 4 on Nov 20, confirmation 4821". Phase 2 already includes the address only when the check was mailed, and only in the requester's email.
- **Budget category.** Phase 2's category dropdown starts on the FO10's Budget Account when that matches a category.
- **CSV.** `check_delivery` is already a column. Add `budget_account` and `payment_account`.
- **Weekly digest.** Adds a section for requests that have been awaiting the signers for more than 7 days.
- **Actions tab.** Once it exists, each signature, send-back and resend adds a row.
- **Product spec.** The *Payment* decision becomes "Paper check. Mailed checks go through the bank's bill pay, with an FO10", *Check delivery* gains mailing, and the Users tab gains `mailed_checks`.

## Security and privacy

- **The signer link** is a signed token with its own purpose (`signer`), naming the signer's address, the request and its version. Every time it's used, the app runs the checks in *Checks on every visit*.
- **Who signed.** Each signature is tied to the address its link was sent to, and the two must differ. A forwarded or leaked link lets someone sign as that one signer, never as both. The real signer still gets the receipt at their own address. This matches the chair and sign-in links, where anyone holding the email can use the link *(default)*.
- **Opening the link** does nothing. Signing needs a separate button press after the page has loaded.
- **What signers see.** Only that one request: its summary and flags, its packet with receipts, and the requester's mailing address and phone number, which the FO10 needs. They can't see the requester's other requests or any stipend balances. Once the request is done, the link shows only a status line.
- **The mailing address** is usually a home address. It's stored in the Requests tab, in `request.json`, on the FO10 and in the authorized packet, which are shared only with AP and the admin, as the product spec already allows. Each check signer gets it in their own inbox. It's left off the reimbursement form, so the event chair doesn't see it.
- **IP addresses and browsers** for signers are kept in the Signatures tab, not in any PDF the requester receives.
- **Who can switch mailing on.** Anyone who can edit the Users tab, the same people who can already change a role or approve an address. A requester can't switch it on for themselves.
- **Bank details.** `BILL_PAY_ACCOUNTS` holds nicknames or last four digits. The app still stores no full bank or card numbers.
- **Who gets links.** Signer links go only to addresses in `CHECK_SIGNERS`, which is set in the app's environment, not in the Sheet. Removing an address and redeploying stops its links at once.
- **Referrers and search engines.** The signer page and its PDF route send no Referer header and ask not to be indexed.
- **The cron route** that sends reminders is protected by `CRON_SECRET`, as it is for the chair step.

**Rules the server enforces**, whatever the form shows:

- It refuses `checkDelivery: "mail"` while mailing is switched off for that requester, whether by their `mailed_checks` cell, by `MAILED_CHECKS`, or by the signer settings. It reads the Users row at signing, not from the session.
- A mailed request goes on to the check signers only while `CHECK_SIGNERS` has two besides the requester and `BILL_PAY_ACCOUNTS` isn't empty. Submit refuses mailing otherwise. The chair's signature is refused until the PTA fixes the settings, so the request never waits for signatures that can't come. Mailing switched off for the account, or paused with `MAILED_CHECKS=off`, doesn't stop the chair: the request was submitted as mailed and carries on.
- Every path that sends a packet to AP sends a mailed request to the signers instead. Those paths are submit, chair signature, chair time-out, a returned request signed again (*Fix and re-sign*), and any later status tool. A single guard refuses to email AP a mailed request that has no authorized packet for its current version.
- Each signature is made once, under the row lock (see *How a signature is recorded*).
- The FO10 is filled from a `request.json` whose packet hash matches the row. Every FO10 and packet a signer is shown, is emailed or signs is first checked against its recorded hash, and so is the authorized packet before a resend to AP. A file that doesn't match isn't shown or sent.

## Rollout

1. **Mail and sign.**
   - The *Mail it to me* choice and the address fields, with the address filled in from the last mailed request.
   - The `mailed_checks` column and the `MAILED_CHECKS` setting.
   - The FO10 template and how it's filled in.
   - The *Awaiting signers* status, the Signatures tab and cell-level writes.
   - The signer emails, with Reply-To set to AP. The signer page with **Sign** for both signatures, including the account fields and the flags, and **Send back**.
   - Signer receipts.
   - The authorized packet, sent straight to AP.
   - The requester's status line and the Resend button.
   - Updated help guides: mailing in the teacher and volunteer guides, and a short page for check signers that their email links to. While `MAILED_CHECKS` is `pilot`, the teacher and volunteer guides leave mailing out, and the PTA tells the people trying it what to expect *(default)*. The check signers' page is always there.

   Mailing stays hidden until `CHECK_SIGNERS` and `BILL_PAY_ACCOUNTS` are set, and then shows only for accounts set to `yes`.
2. **Fix and re-sign.** *Built Nov 19, 2026,* with step 2 of the chair spec, which describes the flow under *Fixing a returned request*. A sent-back request is fixed and re-signed as a new version: `FY27-042-v2.pdf`, and once signed again `FY27-042-v2-fo10-1.pdf` and `FY27-042-v2-authorized.pdf`. Every signer column, the accounts and the FO10 files start blank, links from the old version stop working, and the signer emails and page say which version it is and the note it answers. The sent-back email tells the requester how to fix it. A signer's send-back now also records `returned_by` and `returned_at`.
3. **Nudge.** The 3-day and 7-day reminders, on the chair step's daily cron job.

**Pilot.**

1. Set `CHECK_SIGNERS` and `BILL_PAY_ACCOUNTS`, and leave `MAILED_CHECKS` unset. Nobody is offered mailing yet.
2. Set `mailed_checks` to `yes` for one board member. Have them submit a small mailed request to their own address, have two other signers sign it, and have AP set up a real bill pay payment from the authorized packet.
3. Set `yes` for a few more requesters at a time.
4. When it's ready for everyone, set `MAILED_CHECKS` to `everyone` and redeploy. The guides then describe mailing, and `no` still switches it off for one account.

To pause mailing for everyone, set `MAILED_CHECKS` to `off` and redeploy. The `yes` cells stay, ready for when it goes back to `pilot`. Requests already with the signers carry on to AP. Unsetting `CHECK_SIGNERS` isn't a pause, because it stops every signer link, including those for requests already waiting.

**Order.** Build this after step 1 of the chair spec, which it builds on, and before Phase 2. Like the chair step, it adds a status before *Submitted*, and the dashboard is easier to build once the status model is final.

**Success measures.** The share of mailed requests that reach AP with both signatures, and the number of days from the requester's signature to the second check signer's.

## Open questions

Each has a default. The build follows it unless it is changed here.

| # | Topic | Proposed default |
| --- | --- | --- |
| 1 | A code before signing | No. A forwarded link can only make that one signer's signature, and the real signer gets a receipt. The alternative is that **Sign** emails a 6-digit code to the signer's address, so a link alone can't sign |
| 2 | A new or changed address | Flagged to the signers and AP, and AP decides whether to phone the requester. The alternative is a required phone check above a set amount |
| 3 | Signers don't sign | Reminders at 3 and 7 days, then the weekly digest. The request never goes on unsigned |
| 4 | How long a signer link works | 14 days. Each reminder has a fresh link |
| 5 | Re-signed versions | Both signatures again, even when the change doesn't touch the payment |
| 6 | Budget Account | The stipend first, then the event, otherwise blank. The first signer must fill it in before signing |
| 7 | Offering mailing to everyone | `MAILED_CHECKS=everyone`, so blank cells follow along and new accounts get mailing without a row edit. The alternative is the column alone, where offering it to everyone means a `yes` in every row and on every new approval |
| 8 | The guides during the pilot | They leave mailing out, so most readers don't look for a choice they can't see. The alternative is a line saying some accounts can have checks mailed |

## Changes since v0.6

- Step 2 is built, as the chair spec's *Fix and re-sign*. The send-back email, the signer page and the guides now say the requester can fix and re-sign rather than start a new request.

## Changes since v0.5

From a fourth code review:

- The requester's page links the authorized packet only once AP has it, checked against its hash.
- **Send it to the PTA** clears the recorded failure before sending, so a send that went but couldn't be recorded is never offered again.
- The flags count a request as authorized only when both signers signed it, so an old mailed request that was never approved doesn't count.
- The chair's signature is also refused while `BILL_PAY_ACCOUNTS` is empty, but not because mailing was switched off or paused.
- Signing in and deciding access write only their own cells in the Users tab.

## Changes since v0.4

From a third code review:

- The flags count only requests that went through, so a request a signer sent back, or one still waiting, can't clear them for the next.
- The second signature checks the signer against the first signature's record, not the editable `signer_1_email`.
- AP's email after the second signature goes from the row as the lock wrote it. Anything that stops it is recorded, so the request can't be stuck "on its way" with no **Send it to the PTA**.
- **Send it to the PTA** also sends the requester's copy, which never went the first time.
- The Budget Account the app fills in is made to fit its own rules.
- The FO10 and packet a signer is shown or emailed are checked against their hashes, as they already were when signing.

## Changes since v0.3

From a code review of the first build:

- *How a signature is recorded*: signing takes the row lock that the chair step and resends already use, in place of first-claim-wins in the Signatures tab. One mechanism now covers every step, a resend can't run halfway through a signature, and nothing depends on the tab's row order. The Signatures tab stays as the record of each signature and send-back.
- The second signature takes the Budget Account and Payment Account from the first signature's record, not the editable row, so the FO10, the authorization page and AP's email always agree.
- The authorization page leaves out the flags and the signers' notes, because the requester gets a copy. AP still gets both by email.
- New `authorized_sent_at` and `authorized_send_error` columns record whether AP got the authorized packet. Only a recorded failure makes the requester's page say so and offer **Send it to the PTA**.
- The chair can't sign a mailed request while `CHECK_SIGNERS` has fewer than two signers besides the requester.

## Changes since v0.2

- Mailing is switched on account by account for a slow rollout: a new `mailed_checks` column in the Users tab (`yes`, `no` or blank), and a `MAILED_CHECKS` setting (`off`, `pilot` or `everyone`) that says what a blank cell means and can switch mailing off for everyone. The server checks the account's row when the requester signs.
- The pilot is now a sequence, from one board member to everyone, with a way to pause it.
- Two new open questions: how mailing reaches everyone, and what the guides say during the pilot.

## Changes since v0.1

From a security review of v0.1:

- Signers: an individual address list, `CHECK_SIGNERS`, replaces the alias. Each signer gets their own link, and the two signatures must come from two different addresses, neither of them the requester's. Previously one person on the alias could sign twice under two names.
- Replies to signer emails go to AP, not the requester, because a reply quotes the signing link. **Send back** moves into step 1, and AP gets the note too.
- The authorized packet always goes straight to AP, whatever `SEND_PACKETS_TO` says, so the requester never carries it.
- *Paying the right address*: AP pays only to the address and amount on the signed FO10, and those come from `request.json`, not the editable row.
- *How a signature is recorded*: first-claim-wins in a Signatures tab, and cell-level writes, so two signers at once can't produce two authorized packets.
- A new version clears every signer column and file. The FO10 and packets are checked against their recorded hashes before the second signature.
- Flags for a first mailed request, a changed address or a changed payee name.
- A receipt to each signer after they sign.
- Server-side rules for mailing being switched off, every path to AP, and the token. `CHECK_SIGNERS` is checked when the app starts.
- Address fields limited to one line of plain characters. Payment Account is picked from `BILL_PAY_ACCOUNTS`, and Budget Account is capped.
- Finished links show only a status line. Signer IPs and browsers stay in the Sheet. The address is left off the reimbursement form, so the event chair doesn't see it.
- Open questions 1, 2 and 7 from v0.1 are settled. Two new ones are added: a code before signing, and checks on a new address.
