import type { Metadata } from "next";
import { config } from "@/server/config";
import { MailtoLink } from "@/components/MailtoLink";
import { Guide, Questions, Section, Shot } from "@/components/help/Guide";
import page from "@/images/help/chair/page.png";
import sign from "@/images/help/chair/sign.png";
import signedAp from "@/images/help/chair/signed-ap.png";
import signedRequester from "@/images/help/chair/signed-requester.png";

const title = "Signing reimbursements: a guide for event chairs";

export const metadata: Metadata = { title };

/** Linked from the email that asks an event chair to sign. Chairs have no account, so this is all they see of the portal besides their link. */
export default function ChairGuidePage() {
  const ap = <MailtoLink email={config.apEmail} />;
  const toAp = config.sendPacketsTo === "ap";
  return (
    <Guide
      title={title}
      lead={
        <>
          <p>
            When someone asks the PTA to pay them back for money spent on your event, the request comes to you first. You check it and sign the PTA
            form&apos;s &quot;Signature of VP/Chairman for Program/Event&quot; line. Then it goes on to the PTA for payment.
          </p>
          <p>It takes a minute or two, straight from the email, on your phone or a computer. There&apos;s no account or password.</p>
        </>
      }
    >
      <Section title="The email">
        <p>
          It comes from {config.fromName}, with a subject like &quot;Please sign: Fall Festival reimbursement for Lillie Coit, $57.94&quot;. It lists what was
          bought and has the signed request attached, receipts included. Tap the <strong>Review and sign</strong> link in it.
        </p>
        <p>
          The link works for {config.chairLinkDays} days and only for you, so please don&apos;t forward it. If your event has co-chairs, each of you gets your
          own email; one signature is enough.
        </p>
      </Section>

      <Section title="Step 1: Check the request">
        <p>
          The page shows who&apos;s asking, what it was for, each item and amount, and the PTA form with the receipts on the pages after it. Make sure the
          spending was for your event and the amounts look right.
        </p>
        <p>
          If the PTA has set a budget for your event, it&apos;s at the top: what other requests have claimed this school year, what&apos;s left before this
          one, and what will be left after it. Going over doesn&apos;t stop you from signing; the PTA decides what to reimburse.
        </p>
        <Shot src={page} alt="The top of the signing page: the event's budget before and after this request, then the request's details" />
      </Section>

      <Section title="Step 2: Sign">
        <p>
          Type your full name. It&apos;s printed beside your signature with today&apos;s date. Sign by keeping your name typed, or tap <strong>Draw</strong> and
          sign with your finger. Add a note for the PTA if it helps, like what the purchase was for at the event. Tick the box and tap{" "}
          <strong>Sign</strong>.
        </p>
        <Shot src={sign} alt="The Sign as chair box, with a name, a note to the PTA and the consent box" />
      </Section>

      <Section title="What happens next">
        <p>
          {toAp
            ? "The request goes to the PTA's accounts payable team with your signature on it. You get a copy of the signed form by email for your records."
            : "The person who asked gets the request with your signature on it, to send to the PTA's accounts payable team. You get a copy of the signed form by email for your records."}
        </p>
        <Shot src={toAp ? signedAp : signedRequester} alt="The Signed, thank you message" />
      </Section>

      <Section title="Common questions">
        <Questions
          items={[
            {
              q: "This wasn't for my event, or something looks wrong.",
              a: "Don't sign. Reply to the email: your reply goes to the person who asked, so they can fix it and send a corrected request.",
            },
            {
              q: "The link says it isn't valid or has expired.",
              a: (
                <>
                  Links work for {config.chairLinkDays} days. Ask the person who sent the request to tap <strong>Resend to the chair</strong> on their request
                  page, and you&apos;ll get a fresh link.
                </>
              ),
            },
            { q: "My co-chair already signed.", a: "Then there's nothing more to do. Your link will say who signed and when." },
            {
              q: "Why me?",
              a: <>The PTA keeps a list of events and their chairs. If you&apos;re no longer the chair, or someone else should sign, email {ap}.</>,
            },
            { q: "Who do I ask for help?", a: <>Email {ap}.</> },
          ]}
        />
      </Section>
    </Guide>
  );
}
