import type { Metadata } from "next";
import { config } from "@/server/config";
import { MailtoLink } from "@/components/MailtoLink";
import { Guide, Questions, Section } from "@/components/help/Guide";

const title = "Authorizing mailed checks: a guide for check signers";

export const metadata: Metadata = { title };

/**
 * Linked from the email that asks a check signer to authorize a mailed check.
 * Check signers have no account, so this is all they see of the portal
 * besides their link. Always there, whatever MAILED_CHECKS says.
 */
export default function SignerGuidePage() {
  const ap = <MailtoLink email={config.apEmail} />;
  return (
    <Guide
      title={title}
      lead={
        <>
          <p>
            When someone asks the PTA to mail their reimbursement check, the PTA&apos;s bank mails it by bill pay. Before any bill pay payment, two of the
            PTA&apos;s check signers sign an <em>Authorization for Payment via Electronic Services</em>, the FO10. The portal fills it in from the request and
            emails each check signer a link to sign it.
          </p>
          <p>It takes a couple of minutes, straight from the email, on your phone or a computer. There&apos;s no account or password.</p>
        </>
      }
    >
      <Section title="The email">
        <p>
          It comes from {config.fromName}, with a subject like &quot;Please authorize: mailed check to Harvey Milk, $102.50 (FY27-042)&quot;. It says who is
          asking, how much, and where the check goes, and has the signed request (receipts included) and the FO10 attached. Tap the <strong>Review and sign</strong>{" "}
          link in it.
        </p>
        <p>
          Every check signer gets their own email, and any two of you may sign. The link works for {config.signerLinkDays} days and only for you, so please
          don&apos;t forward it. A reply to the email goes to the PTA. You never get one for a request of your own.
        </p>
      </Section>

      <Section title="Step 1: Check the request">
        <p>
          The page shows the payment (who it&apos;s to, how much, and the address the check is mailed to), the request with each item and amount, the FO10, and
          the PTA form with the receipts on the pages after it. Make sure the spending looks right for the PTA and the amounts add up.
        </p>
        <p>
          A yellow <strong>Worth a second look</strong> box appears when no mailed check has gone through for this account before, when the address is
          different from the last one that did, or when the name is different from earlier requests that went through. Requests that were sent back, or are
          still waiting, don&apos;t count. Those are how a stolen account would show. If something seems off, phone the requester (their number is on the
          page) before you sign.
        </p>
      </Section>

      <Section title="Step 2: Sign">
        <p>
          <strong>If you&apos;re the first to sign,</strong> you also confirm two lines of the FO10. The <strong>Budget Account</strong> is filled in from the
          request, usually the stipend or event it&apos;s paid from; correct it if it&apos;s wrong. Pick the <strong>Payment Account</strong> the money comes from.
          Both are locked once you sign, so the second signer signs exactly what you did.
        </p>
        <p>
          <strong>If you&apos;re the second,</strong> the first signature is already on the FO10 and the two accounts are set.
        </p>
        <p>
          Type your full name. It&apos;s printed beside your signature with today&apos;s date. Sign by keeping your name typed, or tap <strong>Draw</strong> and
          sign with your finger. Add a note for the PTA if it helps. Tick the box and tap <strong>Sign</strong>.
        </p>
      </Section>

      <Section title="What happens next">
        <p>
          After the first signature, the other check signers get an email asking for one more. After the second, the signed FO10 goes in front of the request
          and receipts, and the whole packet goes straight to the PTA&apos;s accounts payable team, who set up the payment at the bank. The requester gets a
          copy.
        </p>
        <p>
          Each time you sign, you get a receipt by email with the FO10 as you signed it. If you ever get one you didn&apos;t expect, tell the PTA at {ap} right
          away.
        </p>
      </Section>

      <Section title="Something not right? Send it back">
        <p>
          Don&apos;t sign. Open <strong>Something not right? Send it back</strong> at the bottom of the page, say what needs to change, and tap{" "}
          <strong>Send back</strong>. The requester and the PTA get your note, and nobody can sign that version any more. The requester fixes it and signs it
          again, and the new version needs two signatures again, even from a signer who signed the old one. Every check signer gets a fresh email and link for
          it.
        </p>
      </Section>

      <Section title="Common questions">
        <Questions
          items={[
            {
              q: "The link says it isn't valid or has expired.",
              a: (
                <>
                  Links work for {config.signerLinkDays} days. The requester can tap <strong>Resend to the check signers</strong> on their request page once a
                  day, and you&apos;ll get a fresh link. Or ask the PTA at {ap}.
                </>
              ),
            },
            { q: "It says I've already signed.", a: "The second signature has to come from a different check signer. There's nothing more for you to do." },
            { q: "It says the request was authorized or sent back.", a: "Two other check signers got to it first, or one sent it back. Your link shows who and when." },
            {
              q: "The requester wants the check sent somewhere else.",
              a: "Send it back with a note. The PTA pays only to the address on the signed FO10, so a new address needs a new version, signed again by the requester and two check signers.",
            },
            {
              q: "Why me?",
              a: <>The PTA keeps a list of its check signers&apos; own addresses. If you&apos;re no longer a check signer, email {ap}.</>,
            },
            { q: "Who do I ask for help?", a: <>Email {ap}.</> },
          ]}
        />
      </Section>
    </Guide>
  );
}
