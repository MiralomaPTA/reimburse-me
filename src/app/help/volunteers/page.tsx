import type { Metadata } from "next";
import { config } from "@/server/config";
import { MailtoLink } from "@/components/MailtoLink";
import { Guide, Questions, Section, Shot } from "@/components/help/Guide";
import { CheckAndSignSection, SignInSection, WhatHappensNext, commonQuestions } from "@/components/help/Shared";
import signIn from "@/images/help/volunteer/sign-in.png";
import checkEmail from "@/images/help/volunteer/check-email.png";
import almostThere from "@/images/help/volunteer/almost-there.png";
import aboutYou from "@/images/help/volunteer/about-you.png";
import whatFor from "@/images/help/volunteer/what-for.png";
import receiptLine from "@/images/help/volunteer/receipt-line.png";
import totals from "@/images/help/volunteer/totals.png";
import checkAndSign from "@/images/help/volunteer/check-and-sign.png";
import doneAp from "@/images/help/volunteer/done-ap.png";
import doneRequester from "@/images/help/volunteer/done-requester.png";
import requestAp from "@/images/help/volunteer/request-ap.png";
import requestRequester from "@/images/help/volunteer/request-requester.png";
import myRequests from "@/images/help/volunteer/my-requests.png";

const title = "Getting reimbursed: a guide for volunteers";

export const metadata: Metadata = { title };

export default function VolunteerGuidePage() {
  const toAp = config.sendPacketsTo === "ap";
  const q = commonQuestions("FY27-001");
  return (
    <Guide
      title={title}
      lead={
        <>
          <p>
            If you&apos;ve paid for something on the PTA&apos;s behalf, this is how you get your money back. You take a photo of each receipt, answer a few
            questions, and sign with your finger or by typing your name. No paper form, no printing, no hunting down someone from the PTA.
          </p>
          <p>The whole thing takes about five minutes and works best on your phone, since that&apos;s where your receipt photos are. A computer works too.</p>
        </>
      }
    >
      <Section title="Before you start">
        <p>Have these handy:</p>
        <ul>
          <li>
            <strong>Your receipts.</strong> A clear photo of each one is all the PTA needs. Cover or crop out card numbers and home addresses first. A long
            receipt can be two or three photos.
          </li>
          <li>
            <strong>What it was for</strong>, in a few words, like &quot;Fall Festival decorations&quot;.
          </li>
          <li>
            <strong>How you&apos;d like your check:</strong> left in a staff mailbox at school, or picked up from the PTA.
          </li>
        </ul>
        <p>One more thing: the first time you use the portal, the PTA approves your email address once, usually within a day. After that, signing in is instant.</p>
      </Section>

      <SignInSection shots={{ signIn, checkEmail, almostThere }} />

      <Section title="Step 2: Start a request and tell us about you">
        <p>
          Tap <strong>New</strong> at the top of the page. In <strong>About you</strong>, fill in your name and a phone number in case the PTA has a question
          for you. The <strong>PTA position</strong> box is optional: leave it blank and the form will say &quot;Volunteer&quot;, or put your role, like
          &quot;Fall Festival chair&quot;. Then choose how you&apos;d like your check.
        </p>
        <Shot src={aboutYou} alt="The About you section, filled in with a name and phone number, the PTA position left blank, and the check choice" wide />
        <p>Next, say what the spending was for in a few words. This is the headline the PTA sees for the whole request, so keep one request to one purpose.</p>
        <Shot src={whatFor} alt="The What was it for section" wide />
        <p>The portal remembers these details from your last request, so next time this part is already filled in.</p>
      </Section>

      <Section title="Step 3: Add your receipts">
        <p>Each receipt gets its own line. For each one:</p>
        <ol>
          <li>Describe what you bought in a few words.</li>
          <li>Enter the total from the receipt.</li>
          <li>
            Tap <strong>Take photo</strong> to snap it with your phone&apos;s camera, or <strong>Choose file</strong> if you already have a photo or PDF.
            You&apos;ll see &quot;Uploaded&quot; when it&apos;s in.
          </li>
        </ol>
        <Shot src={receiptLine} alt="One receipt line, with a description, an amount and an uploaded photo" wide />
        <p>
          Have another receipt? Tap <strong>+ Add another receipt</strong> and repeat. The <strong>Totals</strong> box adds everything up. If you&apos;d like to
          give part of the amount back to the PTA as a donation instead of claiming it, type that amount in the donation box. Otherwise leave it blank.
        </p>
        <Shot src={totals} alt="The Totals box" wide />
        <p>Your work is saved on your phone as you go, so it&apos;s fine to stop and come back later.</p>
      </Section>

      <CheckAndSignSection shots={{ checkAndSign, done: toAp ? doneAp : doneRequester }} />

      <WhatHappensNext check="picked up from the PTA or left in the staff mailbox you chose">
        <p>
          You can see every request you&apos;ve sent under <strong>My requests</strong>, with its status: Submitted, Approved, Returned or Paid.
        </p>
        <Shot src={myRequests} alt="The My requests page, listing one request with its amount and status" />
        <p>Tap a request to see its details and open the signed PDF again at any time.</p>
        <Shot src={toAp ? requestAp : requestRequester} alt="A request's details page, with an Open signed PDF button" />
      </WhatHappensNext>

      <Section title="Common questions">
        <Questions
          items={[
            q.noEmail,
            q.expired,
            q.mistake,
            q.lostReceipt,
            q.computer,
            {
              q: "Each line asks me which stipend paid for it.",
              a: "That shows up when the PTA has given you a yearly stipend of your own. Choose it for purchases that should come out of it, and \"Not from a stipend\" for anything else.",
            },
            {
              q: "Is my information safe?",
              a: (
                <>
                  Your receipts and signed form go only to the PTA&apos;s accounts payable team at <MailtoLink email={config.apEmail} />. Still, crop out card
                  numbers and home addresses before you upload.
                </>
              ),
            },
            q.help,
          ]}
        />
      </Section>
    </Guide>
  );
}
