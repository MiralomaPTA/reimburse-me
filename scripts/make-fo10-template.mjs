// Makes assets/fo10-template.pdf from CAPTA's FO10, the "Authorization for
// Payment via Electronic Services" form, kept in specs/.
//
//   node scripts/make-fo10-template.mjs
//
// The official PDF's fields have names like "KLMNOIPK" and "fill_19". This
// renames them after what they hold, and removes the stray fields above the
// footer and above the treasurer heading. Nothing else changes: the app fills
// the copy through its fields and flattens it. Run it again only if CAPTA
// revises the form, then check the field rectangles in src/server/pdf/fo10.ts.

import { promises as fs } from "node:fs";
import path from "node:path";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, "specs/AuthorizationforPaymentviaElectronicServices-FO10.pdf");
const OUT = path.join(ROOT, "assets/fo10-template.pdf");

const RENAME = {
  K: "date",
  KLMNOIPK: "vendor_name",
  "K Q": "address",
  V: "city_state_zip",
  Text5: "phone_area_code",
  Z: "phone_number",
  W: "email",
  "MKJ5 NLJ": "budget_account",
  NOFISPKLJ: "reason",
  "FISPKLJ5 NLJ": "payment_account",
  FISPKLJ5PNLJ: "payment_amount",
  KMS: "requested_by",
  aKMS: "signer_1_signature",
  K_2: "signer_1_date",
  aKMS_2: "signer_2_signature",
  K_3: "signer_2_date",
  // "For PTA treasurer use": never filled.
  "Check Box6": "treasurer_membership_approved",
  "Check Box7": "treasurer_board_approved",
  "Check Box8": "treasurer_funds_released",
  fill_19: "treasurer_control_number",
  fill_20: "treasurer_category",
  fill_21: "treasurer_amount",
  fill_22: "treasurer_date_posted",
  Text1: "treasurer_president_signature",
  Text2: "treasurer_president_date",
  Text4: "treasurer_minutes_date",
  Text3: "treasurer_secretary_signature",
};

/** Fields over the footer line and the treasurer heading, with nothing printed under them to fill in. */
const REMOVE = ["undefined", "fill_23", "fill_24", "fill_25", "fill_26", "fill_27", "fill_28", "fill_29", "fill_30", "ƒ//ƒ‹"];

const doc = await PDFDocument.load(await fs.readFile(SOURCE));
const form = doc.getForm();
const seen = new Set();
for (const field of form.getFields()) {
  const name = field.getName();
  if (REMOVE.includes(name)) {
    form.removeField(field);
    seen.add(name);
  } else if (RENAME[name]) {
    field.acroField.dict.set(PDFName.of("T"), PDFString.of(RENAME[name]));
    seen.add(name);
  } else {
    throw new Error(`Unexpected field "${name}" in ${SOURCE}: has CAPTA revised the form?`);
  }
}
const missing = [...Object.keys(RENAME), ...REMOVE].filter((name) => !seen.has(name));
if (missing.length) throw new Error(`Fields not found in ${SOURCE}: ${missing.join(", ")}`);

doc.setTitle("Authorization for Payment via Electronic Services (FO10)");
await fs.writeFile(OUT, await doc.save({ useObjectStreams: false }));
console.log(`Wrote ${path.relative(ROOT, OUT)} with ${form.getFields().length} fields.`);
