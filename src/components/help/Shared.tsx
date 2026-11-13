import Link from "next/link";
import type { StaticImageData } from "next/image";
import { config } from "@/server/config";
import { MailtoLink } from "@/components/MailtoLink";
import { Section, Shot } from "@/components/help/Guide";

/**
 * The parts of the two guides that read the same for teachers and volunteers.
 * Wording that depends on how the portal is configured (where packets go, how
 * long links last, the AP address) comes from `config`, so the guides can't
 * drift from the app.
 */

export const linkMinutes = config.magicLinkMinutes;

export function SignInSection({ shots, newcomers }: { shots: { signIn: StaticImageData; checkEmail: StaticImageData; almostThere: StaticImageData }; newcomers?: string }) {
  return (
    <Section title="Step 1: Sign in with your email">
      <p>
        <strong>Open the portal</strong> at{" "}
        <Link href="/" className="underline">
          {config.appUrl.replace(/^https?:\/\//, "")}
        </Link>{" "}
        and type your email address. Tap <strong>Email me a sign-in link</strong>. There&apos;s no password to remember.
      </p>
      <Shot src={shots.signIn} alt="The sign-in page, with a box for your email and a button that says Email me a sign-in link" />
      <p>
        <strong>Check your email</strong> on the same phone or computer. Look for a message from {config.fromName}. The link in it works for {linkMinutes}{" "}
        minutes.
      </p>
      <Shot src={shots.checkEmail} alt="The Check your email page" />
      <p>
        <strong>Tap the link</strong>, then tap <strong>Continue to the portal</strong>. You&apos;re in.
      </p>
      <Shot src={shots.almostThere} alt="The Almost there page, with a Continue to the portal button" />
      <p>
        <strong>First time here?</strong> {newcomers ? `${newcomers} ` : ""}If your address isn&apos;t on the list yet, you&apos;ll see &quot;One quick approval first&quot; instead.
        There&apos;s nothing more for you to do. Once a PTA volunteer approves it, usually within a day, you&apos;ll get an email with your sign-in link.
      </p>
    </Section>
  );
}

/** Step 2's note on the event question, under "What was it for?". */
export function EventQuestion() {
  return (
    <p>
      If the spending was for a PTA event, like the Fun Run or the Fall Festival, choose it under <strong>Which PTA event was this for?</strong> The portal
      picks it for you when your description names the event; change it if that&apos;s wrong. The event&apos;s chair then signs the form too, before it goes
      on to the PTA. For classroom supplies and anything else, leave it on &quot;Not for an event&quot;.
    </p>
  );
}

/** What a request for an event does before it reaches the PTA, in the words that match where the portal sends packets. */
function ChairStep() {
  return (
    <p>
      <strong>For a PTA event,</strong> your request goes to the event&apos;s chair first, to sign the form&apos;s VP/Chairman line. <strong>My requests</strong>{" "}
      shows it as &quot;Awaiting chair&quot; until they do.{" "}
      {config.sendPacketsTo === "ap"
        ? "Then it goes on to the accounts payable team by itself, and you get a copy of the co-signed form."
        : "Then you get the co-signed form by email; that's the one to forward."}{" "}
      If the chair hasn&apos;t signed after a day, open the request and tap <strong>Resend to the chair</strong>. If you chair the event yourself, this step is
      skipped.
    </p>
  );
}

export function CheckAndSignSection({
  shots,
  afterSigning,
  doneAlt,
}: {
  shots: { checkAndSign: StaticImageData; done: StaticImageData };
  afterSigning?: string;
  /** Describes the done screenshot when it isn't the plain "Sent to the PTA" page. */
  doneAlt?: string;
}) {
  const toAp = config.sendPacketsTo === "ap";
  return (
    <Section title="Step 4: Check it over and sign">
      <p>
        Tap <strong>Preview and sign</strong>. The portal fills in the PTA&apos;s official reimbursement form for you and shows it with your receipts attached on
        the pages after it. Look it over. If anything is off, tap <strong>Back to edit</strong> and fix it.
      </p>
      <Shot src={shots.checkAndSign} alt="The Check and sign page, showing the filled-in PTA form above the signature box" />
      <p>
        To sign, type your full name, or tap <strong>Draw</strong> and sign with your finger. Tick the box to confirm the expenses are accurate, then tap{" "}
        <strong>Sign and submit</strong>. That&apos;s the form done.{afterSigning ? ` ${afterSigning}` : ""}
      </p>
      <Shot src={shots.done} alt={doneAlt ?? (toAp ? "The Sent to the PTA page" : "The Signed and ready to send page")} />
    </Section>
  );
}

/** Step 5, in the words that match where the portal sends packets. */
export function WhatHappensNext({ check, stipendNote = false, children }: { check: string; stipendNote?: boolean; children?: React.ReactNode }) {
  const ap = <MailtoLink email={config.apEmail} />;
  if (config.sendPacketsTo === "ap") {
    return (
      <Section title="Step 5: What happens next">
        <p>
          Your signed request goes to the PTA&apos;s accounts payable team, and a copy lands in your inbox with the signed PDF attached.{" "}
          {stipendNote ? "The copy also spells out which stipend each line came from and what's left in it, so you have a record." : "Keep it for your records."}
        </p>
        <p>
          The team checks the request and pays by check, {check}. If anything is missing, they&apos;ll send it back with a note so you can fix it.
        </p>
        <ChairStep />
        {children}
      </Section>
    );
  }
  return (
    <Section title="Step 5: Send it to the PTA, and get paid">
      <p>
        Right away (for a PTA event, once its chair has signed too; see below), you&apos;ll get an email with your signed request attached as a PDF.{" "}
        <strong>Forward that email, with the PDF still attached, to {ap}.</strong>{" "}
        That&apos;s the PTA&apos;s accounts payable team. While the portal is new, this one forwarding step is how your request reaches them.
      </p>
      <ChairStep />
      {stipendNote && <p>The email also spells out which stipend each line came from and what&apos;s left in it, so you have a record.</p>}
      <p>
        The team checks the request and pays by check, {check}. If anything is missing, they&apos;ll email you.
      </p>
      {children}
    </Section>
  );
}

/** The questions both guides answer the same way. */
export function commonQuestions(exampleId: string) {
  const ap = <MailtoLink email={config.apEmail} />;
  return {
    noEmail: {
      q: "I didn't get the sign-in email.",
      a: "Check your spam folder. If it's not there after a couple of minutes, go back to the sign-in page and ask for a new link. If you're new, the PTA may still be approving your address.",
    },
    expired: { q: "The link says it expired.", a: `Links last ${linkMinutes} minutes and work once. Just request a new one.` },
    mistake: {
      q: "I made a mistake after signing.",
      a: (
        <>
          Email {ap} with your request number (it looks like {exampleId}) and what needs to change.
        </>
      ),
    },
    lostReceipt: { q: "I lost a receipt.", a: <>Email {ap} and explain. They&apos;ll tell you what they can do.</> },
    computer: {
      q: "Can I do this on a computer?",
      a: (
        <>
          Yes. Use <strong>Choose file</strong> to add a photo you&apos;ve already taken.
        </>
      ),
    },
    help: { q: "Who do I ask for help?", a: <>Email {ap} for anything about a payment.</> },
    event: {
      q: "It asks which PTA event this was for.",
      a: "That's for spending on a PTA event, like the Fun Run. Pick the event and its chair signs the form before it goes to the PTA. For anything else, leave it on \"Not for an event\".",
    },
    chairSlow: {
      q: "The event chair hasn't signed yet.",
      a: (
        <>
          Open the request from <strong>My requests</strong>. It says who it was sent to and when, and once a day has passed you can tap{" "}
          <strong>Resend to the chair</strong> to send them a fresh link. If the email didn&apos;t reach one of the chairs, you can send it to them
          right away.
        </>
      ),
    },
  };
}
