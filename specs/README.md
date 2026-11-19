# Specs

What each document in this folder covers and how far the build has got. Updated Nov 19, 2026.

## Status

| Spec | Version | Status |
| --- | --- | --- |
| [Teacher Reimbursement Portal — Product Spec](<Teacher Reimbursement Portal — Product Spec.md>) | Draft v0.7, Nov 19 | **Phase 1 built.** The overview of the whole portal, and the source of truth for anything the other specs don't decide |
| [Event Chair Signature — Spec](<Event Chair Signature — Spec.md>) | Draft v0.3, Nov 19 | **Steps 1 and 2 of 3 built** (step 1 merged Nov 12, PR #1; step 2 merged Nov 19, PR #3). No open questions |
| [Mailed Check — Spec](<Mailed Check — Spec.md>) | Draft v0.7, Nov 19 | **Steps 1 and 2 of 3 built** (step 1 merged Nov 19, PR #2; step 2 merged Nov 19 with the chair's, PR #3). Ready for its pilot, which starts with one board member |
| [Phase 2 — AP Workflow Spec](<Phase 2 — AP Workflow Spec.md>) | Draft v0.3, Nov 19 | **Not started**, except 2b's resubmission flow, merged with the chair's step 2 (PR #3) |
| [Code Review — Oct 2026](<Code Review — Oct 2026.md>) | Oct 16 | **Closed.** Every finding was fixed on Oct 16 except item 23, a note about commit history. Kept for the record |

## Roadmap

In build order. The specs ask for the chair and mailed check steps before Phase 2, because each adds a status before *Submitted* and the dashboard is easier to build once the status model is final. Phase 2a only reads the Sheet, so it can be built at any time.

| | Step | Spec | Status |
| --- | --- | --- | --- |
| ✅ | Phase 1 — MVP: sign-in, the form, receipts, the signed PDF packet, email to AP, the Sheet log, stipends | Product | Built Oct 14–28 |
| ✅ | Chair step 1 — *Sign*: the Events tab, the event question, the chair signs the VP/Chairman line | Event Chair | Built Nov 12 |
| ✅ | Mailed check step 1 — *Mail and sign*: *Mail it to me*, the FO10, two check signers, the authorized packet | Mailed Check | Built Nov 19 |
| ✅ | *Send back* and *Fix and re-sign*, with versions | Event Chair step 2, Mailed Check step 2, Phase 2b | Built Nov 19 (PR #3). One shared flow for the chair's, a check signer's and AP's returns. Phase 2b still needs AP's **Return with a note** button and its email |
| ⬜ | A daily cron job: reminders at 3 and 7 days, and the chair's 14-day time-out | Event Chair step 3, Mailed Check step 3 | Not built. The same job can later send the Phase 2 weekly digest and clean up `pending/` |
| ⬜ | Phase 2a — *See*: the AP dashboard (read-only), budget categories, CSV export | Phase 2 | Not built |
| ⬜ | Phase 2b — *Act*: approve, return with a note, record the check, mark it sent, emails to the requester | Phase 2 | Not built, except *Fix and re-sign* (above) |
| ⬜ | Phase 2c — *Nudge*: the weekly digest to AP | Phase 2 | Not built |
| ⬜ | Phase 3 — receipt OCR to fill in line items | Product | An idea only. No spec yet |

Smaller things the product spec lists as not built: deleting uploads in `pending/` that never made it into a request after 30 days (the main [README](../README.md) asks the admin to do this by hand for now), and marking signed files read-only in Drive.

## Open questions

Every open question has a proposed default, and the build follows the default unless the PTA changes it in the spec. These are the ones still waiting for an answer:

- **Who can add the DNS record** for reimburse.miralomasf.com? (Product Spec)
- **Which bookkeeping software** does the PTA use, so the CSV export can match its import? (Product Spec and Phase 2, question 6)

To review the rest of the defaults, see the *Open questions* section of each spec: 11 in the Product Spec, 13 in Phase 2 and 8 in Mailed Check. The Event Chair spec has none left.

## How the specs fit together

- The **Product Spec** describes the whole portal. Each other spec covers one stage and opens by naming the specs it builds on. Those stay the source of truth for what they decide.
- Each spec has the same parts: *Decisions*, *Open questions* with their defaults, a *Rollout* split into steps that are each usable on their own, and a *Changes since* log at the end.
- When a step ships, mark it *Built* with the date in that spec's *Rollout* section, add a line to its *Changes since* log, and update the tables above.

## Reference files

| File | What it is |
| --- | --- |
| `PaymentAuthorizationRequestforReimbursement.pdf` | The PTA's *Payment Authorization / Request for Reimbursement* form (revised July 2022), as published |
| `PaymentAuthorizationRequestforReimbursement-template.pdf` | The same form with its fields renamed. The app uses an identical copy at `assets/form-template.pdf` |
| `AuthorizationforPaymentviaElectronicServices-FO10.pdf` | CAPTA's *Authorization for Payment via Electronic Services* (FO10, revised 07/2022). `scripts/make-fo10-template.mjs` builds `assets/fo10-template.pdf` from it |
