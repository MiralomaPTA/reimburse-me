import type { Metadata } from "next";
import Link from "next/link";
import { config } from "@/server/config";
import { MailtoLink } from "@/components/MailtoLink";
import { Guide, Questions, Section, Shot } from "@/components/help/Guide";
import dashboard from "@/images/help/ap/dashboard.png";
import request from "@/images/help/ap/request.png";
import recordCheck from "@/images/help/ap/record-check.png";
import checkWritten from "@/images/help/ap/check-written.png";
import sendBack from "@/images/help/ap/return.png";

const title = "Paying reimbursements: a guide for the accounts payable team";

export const metadata: Metadata = { title };

/**
 * Whether mailed checks can reach AP: the check signers and bill pay accounts
 * are set. Unlike the requesters' guides (`mailingInGuides`, which wait until
 * mailing is offered to everyone), this covers the pilot too, and stays on
 * when MAILED_CHECKS is off, since requests already on their way still reach
 * AP and still need paying.
 */
const mailingSetUp = () => config.checkSigners.length >= 2 && config.billPayAccounts.length > 0;

export default function ApGuidePage() {
  const ap = <MailtoLink email={config.apEmail} />;
  const mailing = mailingSetUp();
  return (
    <Guide
      title={title}
      lead={
        <>
          <p>
            Every request the portal gets lands on the <strong>AP dashboard</strong>. From there you set each one&apos;s budget category, record its check, mark
            it sent, or send it back with a note, and the portal emails the requester when it matters. It works on a phone or a laptop.
          </p>
          <p>
            The dashboard is for anyone whose row in the Sheet&apos;s Users tab has the role <strong>ap</strong> or <strong>admin</strong>. Sign in with your email
            as usual and you land on it, at{" "}
            <Link href="/ap" className="underline">
              {config.appUrl.replace(/^https?:\/\//, "")}/ap
            </Link>
            .
          </p>
        </>
      }
    >
      <Section title="The list">
        <p>
          It shows what&apos;s with you: every request that isn&apos;t paid yet and isn&apos;t still waiting for its event chair or the check signers. The one
          that&apos;s waited longest is at the top. Its age counts from when it reached you, when it was sent back, or when its check was written. Requests
          sent back, by you or by a chair or check signer, stay on the list while they wait for the requester.
        </p>
        <Shot src={dashboard} alt="The AP dashboard: filters at the top, then a list of requests, oldest first, each with its amount, status and age" />
        <p>
          The list starts on <strong>With AP</strong>. To see something else, pick a <strong>Status</strong> or a <strong>Fiscal year</strong>, or search by
          name, email, what it was for, or request number (like FY27-042), then tap <strong>Show</strong>. On With AP, tick{" "}
          <strong>Show paid requests too</strong> to include paid ones. <strong>Awaiting signature</strong>, under Status, lists the checks you&apos;ve written
          that are waiting for their second signature: the second signer&apos;s to-do list. The link above the list goes straight to it.
        </p>
        <p>
          <strong>Export CSV</strong> downloads whatever the list shows, for the books. It opens cleanly in Excel or Google Sheets.
        </p>
        {mailing && (
          <p>
            A mailed check shows the address it was signed with. A warning under it means the Sheet says something different, or the portal couldn&apos;t check
            what was signed. Either way, pay only to the address and amount on the signed FO10.
          </p>
        )}
      </Section>

      <Section title="One request">
        <p>
          Tap a request to see everything about it: who it&apos;s for, what it was for, how much, the event chair&apos;s and check signers&apos; signatures and
          notes, and its PDFs. Near the bottom, under <strong>Files</strong>, the first (blue) button is the one to pay from: the authorized packet for a mailed
          check, the co-signed one for an event, and otherwise the one the requester signed.
        </p>
        <Shot src={request} alt="The top of one request on the dashboard: who it's from, the budget category, and the Next step box with Approve, Record check and Return with a note" />
        <p>
          The portal checks each of those against the fingerprint (its SHA-256) the Sheet recorded when it was signed. If a file doesn&apos;t match, it won&apos;t
          open it: don&apos;t pay from it, and ask the admin to look. A request signed again after it was sent back also lists its earlier versions, for
          reference. Those aren&apos;t checked, so never pay from one.
        </p>
        <p>
          <strong>History</strong>, at the bottom, lists everything done on the dashboard, with who did it and when.
        </p>
      </Section>

      <Section title="Set the budget category">
        <p>
          Choose it from the dropdown and tap <strong>Save</strong>. The choices come from the Categories tab in the Sheet; to add, rename or retire one, edit
          that tab. {mailing && "When a mailed check's FO10 names a category, the dropdown starts on it, marked as a suggestion until you save. "}You need a
          category before you can record the check.
        </p>
      </Section>

      <Section title="Record the check">
        <p>
          <strong>Approve</strong> is optional. It says you&apos;ve checked the request and will pay it, and nobody is emailed. You can record the check straight
          away instead.
        </p>
        <p>
          Open <strong>Record check</strong>, type the check number and check the date, which starts on today. Tap <strong>Record check</strong>. The request
          becomes <strong>Check written</strong>, and the requester&apos;s page says it&apos;s waiting for its second signature. Nobody is emailed yet.
        </p>
        <Shot src={recordCheck} alt="The Record check form: the check number, the date on the check, and a box for a check that is already signed by both and sent" wide />
        <p>
          If both signers have already signed it and it&apos;s gone out, tick the box under the date. The request is Paid at once, and the requester gets an
          email saying where their check is. That records it as gone out today. If it went out earlier, leave the box unticked, record the check, then use{" "}
          <strong>Mark sent</strong> with the right day.
        </p>
      </Section>

      <Section title="Mark it sent">
        <p>
          Once the check has both signatures and is in the requester&apos;s staff mailbox, or ready for them to pick up, open the request and tap{" "}
          <strong>Mark sent</strong>. The day starts on today. The request is Paid, and the requester gets an email saying where their check is. For a pickup,
          the email tells them it&apos;s ready and to reply to arrange a time. Whoever sends the check can do this, so a check signer with the ap role can mark it
          sent right after signing.
        </p>
        <Shot src={checkWritten} alt="A request whose check is written: the check number and date, the Mark sent box with the day it went out, and Return with a note" wide />
      </Section>

      {mailing && (
        <Section title="Mailed checks (bill pay)">
          <p>
            A mailed check reaches you only after two of the PTA&apos;s check signers have signed its FO10, and its email to {ap} has the authorized packet. Pay
            only to the address and amount on that signed FO10: never the Sheet, and never a new address sent by email. A change of address needs a new
            version, signed again.
          </p>
          <p>
            Set up the payment at the bank, then open <strong>Record bill pay</strong> and enter the bank&apos;s confirmation number and the day you set it up.
            The request stays Check written (the requester sees &quot;Payment set up&quot;) until the bank has mailed the check; then tap{" "}
            <strong>Mark sent</strong>. If the bank has already mailed it when you record it, tick the box instead.
          </p>
          <p>To send back a payment you&apos;ve already set up, cancel it at the bank first. The portal asks you to confirm you have.</p>
        </Section>
      )}

      <Section title="Send it back">
        <p>
          If something needs to change, open <strong>Return with a note</strong> and say what. The requester gets your note by email with a link to fix the
          request and sign it again (or, for a request from before the portal kept a copy to refill, to start a new one; the form tells you which), and {ap}{" "}
          is copied. The fixed version comes back to you as a new version, with your note, after going through its event chair
          {mailing ? " and the check signers" : ""} again if it had them.
        </p>
        <Shot src={sendBack} alt="Return with a note, open, with a note saying what needs to change" wide />
        <p>If you&apos;d already written the check, sending the request back voids it: don&apos;t send that check. Its number stays in the history.</p>
      </Section>

      <Section title="Your own requests">
        <p>
          If you also spend your own money for the PTA, you submit requests like anyone else. The dashboard won&apos;t let you approve, pay or send back your own,
          though: another AP member does those. You can still set its category.
        </p>
      </Section>

      <Section title="Common questions">
        <Questions
          items={[
            {
              q: "A request isn't on the list.",
              a: (
                <>
                  It may still be with its event chair{mailing ? " or the check signers" : ""}: choose{" "}
                  {mailing ? "Awaiting chair or Awaiting signers" : "Awaiting chair"} under Status, or Everything, then tap <strong>Show</strong>. Paid ones
                  show when you tick <strong>Show paid requests too</strong> on With AP.
                </>
              ),
            },
            {
              q: "It says someone else is working on this request.",
              a: "Another step on it is going through at that moment, perhaps from another AP member or the event chair. Wait a minute, reload, and try again.",
            },
            {
              q: "It says the email to the requester didn't go through.",
              a: "The step itself is done. Let the requester know yourself. The Notes on the request's page say what went wrong.",
            },
            {
              q: "I recorded the wrong check number.",
              a: "Fix the check_number cell in the request's row in the Sheet (for bill pay, it holds the bank's confirmation number), and say why in its notes. The request page shows the new number at once, but its History keeps the one you recorded. If it's already Paid, let the requester know: their email had the old number.",
            },
            {
              q: "A paid request needs fixing.",
              a: "Paid is final in the portal. Edit the Sheet and say why in the row's notes.",
            },
            {
              q: "Can I change things in the Sheet directly?",
              a: "To correct something, yes: the portal reads it fresh every time. Say why in the row's notes. Use the dashboard for each step, though: a status typed into the Sheet emails nobody and leaves no history. Never change a request ID, the file ID or SHA-256 cells, or the column headers, and don't change a mailed check's address or amount: the PTA pays from what was signed.",
            },
            {
              q: "Who can use the dashboard?",
              a: "Anyone whose row in the Users tab has the role ap or admin. Change it in the Sheet and it takes effect on their next page.",
            },
            { q: "Who do I ask for help?", a: <>The PTA&apos;s admin, or the rest of the team at {ap}.</> },
          ]}
        />
      </Section>
    </Guide>
  );
}
