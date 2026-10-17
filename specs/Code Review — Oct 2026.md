# Code Review — Oct 2026

Oct 16, 2026 · Review of the working tree at commit `69422fb` plus the uncommitted stipends work · Companion to the *Teacher Reimbursement Portal — Product Spec* (v0.2) and the *Phase 2 — AP Workflow Spec*.

## Summary

**What was checked.** Every file under `src/` and `tests/`, the README, both specs, the example data in `examples/`, and the Next.js 16 docs in `node_modules/next/dist/docs/` for the proxy and route-handler conventions. `npm run typecheck`, `npm run lint`, `npm test` (49 tests) and `npm run build` all pass. `npm audit --omit=dev` reports no known vulnerabilities.

**Overall.** The code is in good shape for the pilot once the five items under *Fix before the pilot* are done. The adapter boundary (`FileStore`, `RequestLog`, `UserDirectory`, `StipendTable`, `Mailer`) is clean and the local versions make development painless. The sign-in design is written down in the spec and the code follows it. Mapping Sheet columns by header name rather than position is the right call for a Sheet AP edits by hand. The tests cover the parts most likely to break: header migration, stipend arithmetic, PDF assembly and access decisions. The README is unusually complete.

Each finding says where it is, why it matters and a suggested fix. Tick them off as they are handled.

| # | Finding | Where |
| --- | --- | --- |
| 1 | `.env.example` is gitignored and not in the repo | `.gitignore` |
| 2 | A session never re-checks the Users tab | `src/server/auth/session.ts`, `src/server/requests/submit.ts` |
| 3 | Open redirect through the `next` parameter | `src/app/page.tsx` and two others |
| 4 | `ADAPTERS` is an unchecked cast | `src/server/config.ts` |
| 5 | Request IDs can collide | `src/server/requests/submit.ts` |
| 6 | Receipts can be reused across requests | `src/server/requests/receipts.ts` |
| 7 | Magic links are reusable for 15 minutes | `src/server/auth/tokens.ts` |
| 8 | Approval links re-approve for 7 days | `src/server/auth/access.ts` |
| 9 | Google API call volume and stale caches | `src/server/adapters/google/` |
| 10 | `submitRequest` cannot be unit-tested | `src/server/requests/submit.ts` |
| 11 | No CI | repo root |
| 12 | Pending uploads are never cleaned up | Drive `pending/` folder |
| 13–23 | Smaller things | various |

## Resolution (Oct 16, 2026)

Everything except item 23 was fixed the same day, in the working tree, with `npm run typecheck`, `npm run lint`, `npm test` (71 tests) and `npm run build` passing afterwards.

| # | What changed |
| --- | --- |
| 1 | `.gitignore` follows the `.env*` rule with `!.env.example`; add the file with `git add .env.example`. |
| 2 | `requireApprovedSession` and `getApprovedSession` in `src/server/auth/session.ts` look the address up in the Users tab on every page and API call. The sign-in page explains a revoked address instead of looping. |
| 3 | `safeNextPath` in `src/lib/next-path.ts`, used by the sign-in page, the callback route and the emailed link; tested in `tests/lib.test.ts`. |
| 4 | `config.adapters` accepts only `local` or `google`, and `getAdapters()` refuses `local` in production unless `ALLOW_LOCAL_ADAPTERS_IN_PRODUCTION=1`. |
| 5 | `submitRequest` re-reads the highest sequence just before claiming the ID and rebuilds the packet on a conflict; the row is now written before the receipts are moved. The window that remains is the PDF upload. |
| 6 | Moving a receipt records the request on the file (`attachedTo`), and `loadReceiptFiles` refuses a receipt that already has one. |
| 7 | `completeSignIn` records `signed_in_at` on the Users row and refuses links issued before it. The new column is appended to existing Sheets automatically. |
| 8 | `decideAccess` refuses an approval link made before the row's `approved_at`; the approve and done pages say so. |
| 9 | `SheetTable` reads the header with the data in one call and writes back cells in columns it doesn't know; the Drive folder cache is gone. |
| 10 | `submitRequest(input, adapters)`; `tests/submit.test.ts` covers the normal path, a foreign receipt, a reused receipt, a wrong stipend, an ID collision, an email failure and a failed move. |
| 11 | `.github/workflows/ci.yml` runs the four checks on push and pull request. |
| 12 | README asks the admin to clear `pending/` of files older than 30 days until there is a job. |
| 13–22 | As described under each item. |
| 23 | Left for the author: splitting the working tree into commits is a decision about history, not code. A suggested grouping is in the hand-over note. |

## Fix before the pilot

### 1. `.env.example` is not in the repository

- [x] **Where.** `.gitignore` line 34 has `.env*`, which matches `.env.example`. `git ls-files` confirms the file is untracked.
- **Why it matters.** The README's first configuration step is "copy `.env.example` to `.env.local`". A fresh clone has no such file, so the next volunteer is stuck before `npm run dev`.
- **Fix.** Add `!.env.example` on the line after `.env*`, then `git add .env.example`. Check the file holds no real values first (today it has placeholders only).

### 2. A session never re-checks the Users tab

- [x] **Where.** `getSession()` in `src/server/auth/session.ts` only verifies the cookie's signature. No page or route handler loads the Users row afterwards to confirm `status` is still `approved`. `submitRequest` (`src/server/requests/submit.ts`, around line 47) fetches the user only to work out stipends and proceeds even when the lookup returns `null`.
- **Why it matters.** The session cookie lasts 30 days. Denying an address, or deleting its row from the Sheet, has no effect on anyone already signed in: they can keep uploading receipts and submitting requests for a month. The spec's model is that the Users tab is the allow-list; today it is only the allow-list for *getting* a cookie.
- **Fix.** Add a `requireApprovedUser()` that calls `getSession()`, loads the row, and rejects unless `status === "approved"`. Use it in `/api/uploads`, `/api/requests/preview`, `/api/requests`, `/requests/[id]/pdf` and the three `/requests` pages. The Phase 2 spec already plans to read the row on every AP page load, so this is the same lookup. The extra Sheet read per request is acceptable; see finding 9 for keeping the total down.

### 3. Open redirect through the `next` parameter

- [x] **Where.** Three places accept a `next` path and redirect to it after sign-in:
  - `src/app/page.tsx` line 11 only checks `startsWith("/")`, so `/?next=//evil.com` sends a signed-in visitor off-site.
  - `src/app/api/auth/callback/route.ts` line 21 and `src/server/auth/access.ts` line 31 also reject `//`, but not `/\evil.com`. Browsers normalise a backslash to a slash in URLs, so that value becomes a protocol-relative link to `evil.com`.
- **Why it matters.** A phishing email can link to the real portal and still land the teacher on an attacker's page after a genuine sign-in.
- **Fix.** One helper in `src/lib`, used by all three call sites:

  ```ts
  /** A same-origin path to return to after sign-in, or null. */
  export function safeNextPath(next: unknown): string | null {
    if (typeof next !== "string" || !next.startsWith("/")) return null;
    if (next.startsWith("//") || next.includes("\\")) return null;
    return next;
  }
  ```

  Add a test with `//evil.com`, `/\evil.com`, `https://evil.com` and `/requests/FY27-001`.

### 4. `ADAPTERS` is an unchecked cast

- [x] **Where.** `src/server/config.ts` line 22: `adapters: (env.ADAPTERS ?? "local") as AdapterKind`.
- **Why it matters.** A typo in the Vercel environment (`googel`, `Google`, a trailing space) silently selects the local adapter. On Vercel that writes requests to the function's ephemeral disk and prints emails to the log. Every submission looks successful to the teacher and nothing is kept. This is the single most expensive misconfiguration the app can have, and nothing would notice it.
- **Fix.** Validate the value and refuse to start in production unless it is `google`:

  ```ts
  const adapters = env.ADAPTERS ?? "local";
  if (adapters !== "local" && adapters !== "google") throw new Error(`ADAPTERS must be "local" or "google", not "${adapters}"`);
  if (isProduction && adapters === "local" && env.ALLOW_LOCAL_ADAPTERS_IN_PRODUCTION !== "1") {
    throw new Error("ADAPTERS=local would write to the serverless filesystem; set ADAPTERS=google");
  }
  ```

### 5. Request IDs can collide

- [x] **Where.** `src/server/requests/submit.ts` around line 60 reads the highest sequence, then builds the PDF (seconds), then appends the row.
- **Why it matters.** Two submissions inside that window both become, say, `FY27-042`. They share a Drive folder, both rows carry the same ID, and `log.get` returns the first row, so the second requester's request page and PDF link return 404 even though AP was emailed. Unlikely at PTA scale, but Vercel runs concurrent instances and the failure is confusing to diagnose.
- **Fix.** Cheapest: after `append`, re-read the rows with that ID; if there is more than one, update this row's `request_id` to the next free number and rename the Drive folder. Cleaner: allocate the ID as late as possible (just before `append`), which shrinks the window to a few hundred milliseconds. Fully safe: make the stored key opaque (a UUID) and keep `FY27-042` as a display number assigned on append.

## Worth doing soon

### 6. Receipts can be reused across requests

- [x] **Where.** `loadReceiptFiles` in `src/server/requests/receipts.ts` (line 20) only checks that the uploader matches the session. `moveFile` in `src/server/adapters/google/files.ts` (line 133) removes the file from every parent and adds the target.
- **Why it matters.** A receipt already attached to a submitted request passes the check again, so the same receipt can be claimed twice. The move then pulls it out of the earlier request's Drive folder, so that folder no longer holds the receipts its PDF was built from. The signed PDF still contains the image, so the audit trail survives, but the folder is now incomplete.
- **Fix.** On move, set `appProperties.requestId` (Google) or `folderPath` (local). In `loadReceiptFiles`, reject any receipt that already has a request ID or whose parent is not `pending/`. Error text: "A receipt was already used in request FY27-031. Upload it again if it belongs to this request too."

### 7. Magic links are reusable for 15 minutes

- [x] **Where.** `createMagicToken` in `src/server/auth/tokens.ts` sets a `jti` but `verifyMagicToken` never checks it, and the callback route never records use.
- **Why it matters.** The sign-in page says the link "has expired or was already used"; the second half is not true. Anyone who gets the link within 15 minutes (a forwarded email, a shared screen) can also sign in.
- **Fix.** Add a `signed_in_at` column to Users. When a magic token is consumed, write the time and reject any magic token whose `iat` is earlier than the row's `signed_in_at`. One extra Sheet write per sign-in.

### 8. Approval links re-approve for 7 days

- [x] **Where.** `decideAccess` in `src/server/auth/access.ts` lines 117–131.
- **Why it matters.** The same emailed link, valid for 7 days, flips a *denied* address back to approved and sends a sign-in link. The done page also says "We emailed them a sign-in link" on the idempotent path, which sends nothing.
- **Fix.** Reject an approval token whose `iat` is earlier than the row's `approved_at` (the time of the last decision). Make the done page say what happened: approved and emailed, settings updated, or already approved.

### 9. Google API call volume and stale caches

- [x] **Where.** `SheetTable.headers()` (`src/server/adapters/google/sheet-table.ts`) is called on every `readAll`, `append` and `update`. `currentFunding` runs on every `/requests` and `/requests/new` page view and reads three whole tabs. `folderCache` in `src/server/adapters/google/files.ts` is never invalidated.
- **Why it matters.** A page view is six Sheets requests; a submit is roughly ten plus the Drive calls. The Sheets quota is 300 requests a minute per project. A PTA will not hit it, but a stuck retry loop or a future dashboard could. Separately, Drive IDs survive renames and moves, but if AP trashes `pending/` or a fiscal-year folder, the cached ID keeps pointing at the trashed folder until the next cold start.
- **Fix.** Caching the header row was considered and rejected: a column AP inserts between two reads would make a cached header write values into the wrong cells. Instead, read the header together with the data in one call, so `readAll` and `find` cost one read and `append`, `update` and `upsert` one read and one write. Document the quota in the README. Drop the folder cache and accept one extra `files.list` per path element.

### 10. `submitRequest` cannot be unit-tested

- [x] **Where.** `src/server/requests/submit.ts` line 43 calls `getAdapters()`, the module singleton.
- **Why it matters.** `requestSignIn` and `decideAccess` take an injectable `deps` object and have good tests as a result. The submit transaction (ID, PDF, store, move, append, two emails, partial-failure handling) is the most important code path and has none.
- **Fix.** Give `submitRequest` the same shape: `submitRequest(input, deps = await getAdapters())`. Then write tests with in-memory adapters for: a normal submit, an email failure (row written, `emailed: false`, note recorded), a stipend the user does not have, and a receipt uploaded by someone else.

### 11. No CI

- [x] **Where.** There is no `.github/workflows/` directory.
- **Why it matters.** All four checks pass locally today. Once a second volunteer pushes, nothing enforces that.
- **Fix.** One workflow on push and pull request: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. The build needs network access for the Google font; that is fine on GitHub Actions.

### 12. Pending uploads are never cleaned up

- [x] **Where.** Files uploaded to `pending/` stay there unless the request is submitted. The product spec lists the 30-day cleanup under *Open questions* as not built.
- **Why it matters.** Abandoned drafts (and every upload that was removed from the form before submitting) accumulate in fs@'s Drive forever. Receipts can hold personal data.
- **Fix.** Until there is a scheduled job, add a line to the README's Phase 0 section asking the admin to clear `pending/` of files older than 30 days now and then. The job itself is a Phase 2 candidate.

## Smaller things

- [x] 13. `src/server/pdf/pages.ts` line 168 hardcodes `ap@miralomasf.com` in the audit page text. Use `config.apEmail`.
- [x] 14. `src/server/auth/access.ts` line 120: `same(existing.email, email)` is always true, because `existing` was looked up by that email. Drop it.
- [x] 15. The 10 MB upload limit lives in `src/server/config.ts`, `src/lib/upload-client.ts` line 34 and the error text in `src/app/api/uploads/route.ts` line 10. Export one `MAX_UPLOAD_BYTES` from `src/lib/request-schema.ts` and derive the message from it.
- [x] 16. `src/app/api/local-upload/[id]/route.ts` has no session check. It is dev-only, but requiring a session keeps the local path honest about what production enforces.
- [x] 17. `/api/auth/request-link` answers `sent` for approved addresses and `pending` for everything else, so the response reveals who is on the allow-list. Acceptable for a PTA; say so in the spec's security section so it is a decision rather than an accident.
- [x] 18. `sessionSecret()` accepts any non-empty string. HS256 with a short secret is weak. Require at least 32 bytes in production.
- [x] 19. `src/proxy.ts` redirects to `/?next=<pathname>` and drops the query string.
- [x] 20. `src/components/NewRequestForm.tsx` line 479: the read-only Email field's label has no `htmlFor`.
- [x] 21. Submission emails build links from `config.appUrl` while auth emails use `linkBase(request)`. In development the two can point at different ports.
- [x] 22. Vitest warns that `vitest.config.ts` uses ESM syntax in a CommonJS context. Add `"type": "module"` to `package.json` or rename the file to `vitest.config.mts`.
- [ ] 23. The current uncommitted change mixes the stipends feature, the Sheet column migration, the example data and two spec edits. Split it into a few commits so each can be reviewed and reverted on its own.

## What is good and should stay

- The five adapter interfaces in `src/server/adapters/types.ts`, with the Sheet header names doubling as the TypeScript keys.
- `SheetTable` finding rows by key and columns by header, and now appending new columns to an existing header row. The tests in `tests/sheet-table.test.ts` cover the migration cases well.
- The sign-in model: nothing is ever emailed to an unknown address, the approver gets one email, the daily cap bounds Sheet growth, and the click-to-complete callback defeats link scanners.
- Receipts never pass through the app server, and the uploader is recorded server-side so a request cannot point at someone else's file.
- `fundingOptions` is a pure function over the Users row, the Stipends tab and the request log, which made it straightforward to test and keeps the "warn, never block" rule in one place.
- The README and both specs say what is built, what is decided and what is not, in plain language a future volunteer can follow.
