import type { Metadata } from "next";
import { config } from "@/server/config";
import { MailtoLink } from "@/components/MailtoLink";
import { Guide, Questions, Section, Shot } from "@/components/help/Guide";
import { CheckAndSignSection, SignInSection, WhatHappensNext, commonQuestions } from "@/components/help/Shared";
import signIn from "@/images/help/teacher/sign-in.png";
import checkEmail from "@/images/help/teacher/check-email.png";
import almostThere from "@/images/help/teacher/almost-there.png";
import aboutYou from "@/images/help/teacher/about-you.png";
import whatFor from "@/images/help/teacher/what-for.png";
import receiptLine from "@/images/help/teacher/receipt-line.png";
import totals from "@/images/help/teacher/totals.png";
import checkAndSign from "@/images/help/teacher/check-and-sign.png";
import doneAp from "@/images/help/teacher/done-ap.png";
import doneRequester from "@/images/help/teacher/done-requester.png";
import requestAp from "@/images/help/teacher/request-ap.png";
import requestRequester from "@/images/help/teacher/request-requester.png";
import myRequests from "@/images/help/teacher/my-requests.png";
import stipends from "@/images/help/teacher/stipends.png";

const title = "Getting reimbursed: a guide for teachers";

export const metadata: Metadata = { title };

export default function TeacherGuidePage() {
  const toAp = config.sendPacketsTo === "ap";
  const q = commonQuestions("FY27-002");
  const ap = <MailtoLink email={config.apEmail} />;
  return (
    <Guide
      title={title}
      lead={
        <>
          <p>
            When you&apos;ve spent your own money on your classroom, your grade, or a field trip, this is how the PTA pays you back. You take a photo of each
            receipt, answer a few questions, say which stipend it comes from, and sign with your finger or by typing your name. No paper form, no printing,
            no hunting down someone from the PTA.
          </p>
          <p>
            It takes about five minutes and works best on your phone, since that&apos;s where your receipt photos are. Along the way you&apos;ll see how much
            of each stipend you have left.
          </p>
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
            <strong>What it was for</strong>, in a few words, like &quot;2nd grade art supplies&quot;.
          </li>
          <li>
            <strong>How you&apos;d like your check:</strong> left in your staff mailbox, or picked up from the PTA.
          </li>
        </ul>
        <p>
          <strong>Your stipends, in plain words.</strong> Each line of your request says which pot of PTA money pays for it:
        </p>
        <ul>
          <li>
            <strong>Classroom stipend:</strong> yours alone, for your classroom.
          </li>
          <li>
            <strong>Grade stipend</strong> (for example &quot;Grade 2 stipend&quot;): shared by all the teachers in your grade. If you teach a combination class,
            you&apos;ll see one for each grade.
          </li>
          <li>
            <strong>Field trip:</strong> one fund shared by the whole school.
          </li>
          <li>
            <strong>Not from a stipend:</strong> anything else the PTA has agreed to reimburse.
          </li>
        </ul>
        <p>
          The PTA sets the amounts each school year, and the portal shows how much of each is left before you submit. Going over doesn&apos;t stop you from
          submitting; a PTA member will reach out to you to help figure out where the money should come from.
        </p>
      </Section>

      <SignInSection shots={{ signIn, checkEmail, almostThere }} newcomers="Most teachers are already on the list." />

      <Section title="Step 2: Start a request and tell us about you">
        <p>
          Tap <strong>New</strong> at the top of the page. In <strong>About you</strong>, fill in your name, the grade you teach, your room number, and a
          phone number in case the PTA has a question for you. The grade usually starts filled in. On the PTA&apos;s form this reads like &quot;Teacher - 2nd -
          Room 106&quot;. Then choose how you&apos;d like your check.
        </p>
        <Shot src={aboutYou} alt="The About you section, filled in with a name, grade, room, phone number and check choice" wide />
        <p>Next, say what the spending was for in a few words. This is the headline the PTA sees for the whole request, so keep one request to one purpose.</p>
        <Shot src={whatFor} alt="The What was it for section" wide />
        <p>The portal remembers these details from your last request, so next time this part is already filled in.</p>
      </Section>

      <Section title="Step 3: Add your receipts and say which stipend pays">
        <p>Each receipt gets its own line. For each one:</p>
        <ol>
          <li>Describe what you bought in a few words.</li>
          <li>Enter the total from the receipt.</li>
          <li>
            Under <strong>Paid from</strong>, choose the stipend this purchase comes from. Each choice shows how much is left in it.
          </li>
          <li>
            Tap <strong>Take photo</strong> to snap the receipt with your phone&apos;s camera, or <strong>Choose file</strong> if you already have a photo or
            PDF. You&apos;ll see &quot;Uploaded&quot; when it&apos;s in.
          </li>
        </ol>
        <Shot src={receiptLine} alt="One receipt line, with a description, an amount, the stipend it is paid from and an uploaded photo" wide />
        <p>
          Have another receipt? Tap <strong>+ Add another receipt</strong> and repeat. The new line starts with the same stipend as the one before, so change
          it if this purchase came from a different one.
        </p>
        <p>
          <strong>One receipt, two stipends?</strong> Say you bought markers for your classroom and clay for the whole grade in one trip. Add a line for each
          share with its own amount, and on the second line use <strong>Same receipt as another line…</strong> to attach the same photo.
        </p>
        <p>
          The <strong>Totals</strong> box adds everything up and shows what&apos;s left in each stipend after this request. If you&apos;d like to give part of
          the amount back to the PTA as a donation instead of claiming it, type that in the donation box. Otherwise leave it blank.
        </p>
        <Shot src={totals} alt="The Totals box, with what is left in each stipend after this request" wide />
        <p>
          If a line takes a stipend past what&apos;s left, you&apos;ll see a yellow note. You can still submit; a PTA member will reach out to help figure out
          where the money should come from. Your work is saved on your phone as you go, so it&apos;s fine to stop and come back later.
        </p>
      </Section>

      <CheckAndSignSection shots={{ checkAndSign, done: toAp ? doneAp : doneRequester }} afterSigning="The page also shows what's left in each stipend you used." />

      <WhatHappensNext check="left in your staff mailbox or picked up from the PTA" stipendNote />

      <Section title="Keeping track of your stipends">
        <p>
          <strong>My requests</strong> shows each of your stipends for this school year: how much has been claimed, how much of that is still waiting to be
          paid, and what&apos;s left. A shared stipend counts everyone in your grade, so the number can move even when you haven&apos;t sent anything.
        </p>
        <Shot src={stipends} alt="The stipends box on the My requests page, with a bar for each stipend and what is left" wide />
        <p>Below that is every request you&apos;ve sent, with its amount, which stipend it came from, and its status: Submitted, Approved, Returned or Paid.</p>
        <Shot src={myRequests} alt="The My requests page" />
        <p>Tap a request to see its details and open the signed PDF again at any time.</p>
        <Shot src={toAp ? requestAp : requestRequester} alt="A request's details page, with an Open signed PDF button" />
      </Section>

      <Section title="Common questions">
        <Questions
          items={[
            q.noEmail,
            q.expired,
            {
              q: "My grade is wrong, or a stipend I should see is missing.",
              a: <>Email {ap} and they&apos;ll fix it. The list of stipends you see comes from how the PTA has you set up.</>,
            },
            {
              q: "I'm over my stipend.",
              a: "You can still submit. The portal shows a yellow note, and a PTA member will reach out to help figure out where the money should come from.",
            },
            q.mistake,
            q.lostReceipt,
            q.computer,
            { q: "Who do I ask for help?", a: <>Email {ap} for anything about a payment or a stipend.</> },
          ]}
        />
      </Section>
    </Guide>
  );
}
