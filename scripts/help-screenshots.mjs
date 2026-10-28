// Regenerates the screenshots in src/images/help used by the /help guides.
//
//   npm run help:screenshots
//
// Starts `next dev` on its own port with the local adapters and a throwaway
// data folder (.data/help-screenshots, seeded from examples/local-data), walks
// through a request as a volunteer and as a teacher on a phone-sized browser,
// and crops the pages the guides show. The done and request pages are captured
// in both SEND_PACKETS_TO modes so the guide can show whichever is configured.
//
// Needs Playwright's Chromium (`npx playwright install chromium`). The "Check
// and sign" page shows the preview PDF in a frame that headless Chromium
// leaves blank, so the first page of the PDF is rendered with Quick Look
// (macOS) or pdftoppm (poppler) and drawn in its place; without either tool
// that one screenshot shows an empty frame.

import { execFileSync, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, devices } from "playwright";
import sharp from "sharp";

const ROOT = process.cwd();
const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = ".data/help-screenshots";
const OUT = path.join(ROOT, "src/images/help");
const OUTBOX = path.join(ROOT, DATA_DIR, "outbox");
const WIDTH = 720;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const personas = {
  volunteer: {
    email: "volunteer@example.org",
    name: "Lillie Coit",
    // Left blank on purpose: the form fills in "Volunteer".
    position: "",
    phone: "(415) 555-0142",
    pickup: true,
    purpose: "Fall Festival decorations",
    items: [
      { desc: "Streamers, balloons and table covers", amount: "42.18", receipt: "party" },
      { desc: "Poster board and glue sticks", amount: "15.76", receipt: "poster" },
    ],
  },
  teacher: {
    email: "grade2.teacher@example.org",
    name: "Harvey Milk",
    grade: "2nd",
    room: "106",
    phone: "(415) 555-0199",
    purpose: "2nd grade art supplies",
    items: [
      { desc: "Markers, construction paper and glue", amount: "38.50", funding: "classroom", receipt: "art" },
      { desc: "Air-dry clay for the pottery unit", amount: "64.00", funding: "grade:2", receipt: "clay" },
    ],
  },
};

const receipts = {
  party: { store: "PARTY TOWN", addr: "2675 Geary Blvd, San Francisco", date: "10/18/2026  2:41 PM", rows: [["CREPE STREAMERS x6", "17.94"], ["LATEX BALLOONS 50PK", "12.99"], ["BALLOON RIBBON", "3.49"], ["TABLE COVERS x2", "4.40"]], sub: "38.82", tax: "3.36", total: "42.18" },
  poster: { store: "CORNER DRUG", addr: "1189 Portola Dr, San Francisco", date: "10/19/2026  9:12 AM", rows: [["POSTER BOARD WHITE x4", "9.96"], ["GLUE STICKS 4PK", "4.55"]], sub: "14.51", tax: "1.25", total: "15.76" },
  art: { store: "SF ART & SCHOOL SUPPLY", addr: "601 Ocean Ave, San Francisco", date: "10/14/2026  4:03 PM", rows: [["WASHABLE MARKERS 24CT x2", "15.98"], ["CONSTRUCTION PAPER 500", "11.49"], ["GLUE STICKS 12PK", "7.97"]], sub: "35.44", tax: "3.06", total: "38.50" },
  clay: { store: "SF ART & SCHOOL SUPPLY", addr: "601 Ocean Ave, San Francisco", date: "10/21/2026  3:35 PM", rows: [["AIR DRY CLAY 10LB x2", "45.98"], ["CLAY TOOL SET", "12.94"]], sub: "58.92", tax: "5.08", total: "64.00" },
};

/** How much of each full-page screenshot to keep: a height in device pixels, a negative trim off the bottom, or 0 for all. */
const crop = {
  "sign-in": 1720,
  "check-email": 760,
  "almost-there": 760,
  "about-you": 0,
  "what-for": 0,
  "receipt-line": 0,
  "totals": 0,
  "check-and-sign": -240,
  "done-ap": 760,
  "done-requester": 1000,
  "request-ap": -240,
  "request-requester": -240,
  "my-requests": 1080,
  "stipends": 0,
};
// The teacher's pages run longer: stipend lines on the done page, stipend bars above the list.
const teacherCrop = { "done-ap": 1000, "done-requester": 1200, "my-requests": -330 };

async function seedData() {
  await fs.rm(path.join(ROOT, DATA_DIR), { recursive: true, force: true });
  await fs.mkdir(path.join(ROOT, DATA_DIR), { recursive: true });
  for (const f of ["users.json", "stipends.json"]) {
    await fs.copyFile(path.join(ROOT, "examples/local-data", f), path.join(ROOT, DATA_DIR, f));
  }
}

function startServer(sendPacketsTo) {
  const child = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, ADAPTERS: "local", LOCAL_DATA_DIR: DATA_DIR, SEND_PACKETS_TO: sendPacketsTo, APP_URL: BASE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  child.on("exit", (code) => {
    if (code && code !== 143 && code !== 130) console.error(log);
  });
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(BASE + "/");
      if (r.status < 500) return;
    } catch {}
    await sleep(1000);
  }
  throw new Error("next dev did not come up on port " + PORT);
}

async function stopServer(child) {
  if (!child.pid) return;
  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
  // next dev listens from a child of the npx process; make sure the port is free.
  for (let i = 0; i < 20; i++) {
    try {
      await fetch(BASE + "/");
      try { execFileSync("lsof", ["-ti", `tcp:${PORT}`]).toString().split("\n").filter(Boolean).forEach((pid) => process.kill(Number(pid), "SIGTERM")); } catch {}
      await sleep(500);
    } catch {
      return;
    }
  }
}

async function latestLinkFor(email, since) {
  const files = (await fs.readdir(OUTBOX).catch(() => [])).filter((f) => f.endsWith(".json")).sort().reverse();
  for (const f of files) {
    const mail = JSON.parse(await fs.readFile(path.join(OUTBOX, f), "utf8"));
    if (!mail.to.includes(email) || !/sign-in/i.test(mail.subject)) continue;
    if (new Date(mail.sentAt) < since) return null;
    const m = mail.text.match(/https?:\/\/\S+\/auth\/callback\S*/);
    if (m) return m[0];
  }
  return null;
}

async function makeReceipt(browser, file, r) {
  const page = await browser.newPage({ viewport: { width: 520, height: 820 }, deviceScaleFactor: 2 });
  const rows = r.rows.map(([d, a]) => `<tr><td>${d}</td><td class="r">${a}</td></tr>`).join("");
  await page.setContent(`<html><body style="margin:0;background:#d9d4cc;padding:28px;font-family:'Courier New',monospace">
  <div style="background:#fff;padding:28px 26px;color:#222;box-shadow:0 2px 6px rgba(0,0,0,.25);transform:rotate(-1.2deg)">
  <div style="text-align:center;font-weight:bold;font-size:20px;letter-spacing:1px">${r.store}</div>
  <div style="text-align:center;font-size:13px;margin-top:4px">${r.addr}</div>
  <div style="text-align:center;font-size:13px">${r.date}</div>
  <hr style="border:0;border-top:1px dashed #999;margin:16px 0">
  <table style="width:100%;font-size:15px;border-collapse:collapse">${rows}</table>
  <hr style="border:0;border-top:1px dashed #999;margin:16px 0">
  <table style="width:100%;font-size:15px"><tr><td>SUBTOTAL</td><td class="r">${r.sub}</td></tr><tr><td>TAX 8.625%</td><td class="r">${r.tax}</td></tr><tr style="font-weight:bold;font-size:18px"><td>TOTAL</td><td class="r">${r.total}</td></tr></table>
  <div style="margin-top:14px;font-size:13px">VISA ************4821<br>APPROVED</div>
  <div style="text-align:center;margin-top:18px;font-size:13px">THANK YOU FOR SHOPPING WITH US</div>
  </div><style>.r{text-align:right}td{padding:3px 0}</style></body></html>`);
  await page.screenshot({ path: file, type: "jpeg", quality: 85 });
  await page.close();
}

async function newContext(browser) {
  const ctx = await browser.newContext({ ...devices["iPhone 14"], locale: "en-US", timezoneId: "America/Los_Angeles" });
  // Hide the Next.js dev-tools badge.
  await ctx.addInitScript(() => {
    const add = () => {
      const s = document.createElement("style");
      s.textContent = "nextjs-portal{display:none!important}";
      document.documentElement.appendChild(s);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add);
    else add();
  });
  return ctx;
}

/** Full-page screenshot, cropped and scaled for the guide. */
async function shot(page, persona, name, { element, fullPage = true } = {}) {
  const buffer = element ? await element.screenshot() : await page.screenshot({ fullPage });
  const keep = { ...crop, ...(persona === "teacher" ? teacherCrop : {}) }[name] ?? 0;
  const img = sharp(buffer);
  const m = await img.metadata();
  const height = keep === 0 ? m.height : keep < 0 ? m.height + keep : Math.min(keep, m.height);
  await img.extract({ left: 0, top: 0, width: m.width, height }).resize({ width: WIDTH }).png({ compressionLevel: 9 }).toFile(path.join(OUT, persona, `${name}.png`));
}

/** Draws the first page of the preview PDF where the (blank) frame is. */
async function showPreview(page, tmp) {
  const b64 = await page.evaluate(async () => {
    const frame = document.querySelector("iframe");
    const bytes = new Uint8Array(await (await fetch(frame.src)).arrayBuffer());
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  });
  const pdf = path.join(tmp, "preview.pdf");
  await fs.writeFile(pdf, Buffer.from(b64, "base64"));
  let png = null;
  try {
    execFileSync("qlmanage", ["-t", "-s", "1400", "-o", tmp, pdf], { stdio: "ignore" });
    png = pdf + ".png";
  } catch {
    try {
      execFileSync("pdftoppm", ["-png", "-r", "150", "-f", "1", "-l", "1", "-singlefile", pdf, path.join(tmp, "preview")], { stdio: "ignore" });
      png = path.join(tmp, "preview.png");
    } catch {
      console.warn("neither qlmanage nor pdftoppm found; the Check and sign screenshot will show an empty preview");
      return;
    }
  }
  const data = "data:image/png;base64," + (await fs.readFile(png)).toString("base64");
  await page.evaluate((src) => {
    const frame = document.querySelector("iframe");
    const wrap = document.createElement("div");
    wrap.className = frame.className;
    wrap.style.cssText = "overflow:hidden;background:#525659;display:flex;justify-content:center;align-items:flex-start;padding:12px";
    const img = document.createElement("img");
    img.src = src;
    img.style.cssText = "width:100%;box-shadow:0 1px 6px rgba(0,0,0,.5);background:#fff";
    wrap.appendChild(img);
    frame.replaceWith(wrap);
  }, data);
  await sleep(500);
}

async function signIn(ctx, persona, p, capture) {
  const page = await ctx.newPage();
  await page.goto(BASE + "/");
  await page.waitForSelector("#email");
  await sleep(500);
  if (capture) await shot(page, persona, "sign-in");
  const since = new Date(Date.now() - 1000);
  await page.fill("#email", p.email);
  await page.click("button[type=submit]");
  await page.waitForURL(/auth\/sent/);
  await sleep(500);
  if (capture) await shot(page, persona, "check-email");
  let link = null;
  for (let i = 0; i < 40 && !link; i++) {
    link = await latestLinkFor(p.email, since);
    if (!link) await sleep(500);
  }
  if (!link) throw new Error("no sign-in email for " + p.email);
  await page.goto(link);
  await page.waitForSelector("text=Almost there");
  if (capture) await shot(page, persona, "almost-there");
  await page.click("text=Continue to the portal");
  await page.waitForURL(/\/requests/);
  return page;
}

/** Fills, signs and submits one request. `mode` names the done/request screenshots; `capture` takes the form shots too. */
async function submitRequest(page, persona, p, { mode, capture, tmp }) {
  await page.goto(BASE + "/requests/new");
  await page.waitForSelector("#payeeName");
  await page.fill("#payeeName", p.name);
  if (p.room) {
    await page.fill("#grade", p.grade);
    await page.fill("#room", p.room);
  } else if (p.position) {
    await page.fill("#ptaPosition", p.position);
  }
  await page.fill("#phone", p.phone);
  await page.click(p.pickup ? "text=Arrange pickup with the PTA" : "text=Leave it in my staff mailbox");
  await page.fill("#purpose", p.purpose);
  for (let i = 0; i < p.items.length; i++) {
    if (i > 0) await page.click("text=+ Add another receipt");
    const item = p.items[i];
    await page.locator("input[id^=desc-]").nth(i).fill(item.desc);
    await page.locator("input[id^=amt-]").nth(i).fill(item.amount);
    if (item.funding) await page.locator("select[id^=funding-]").nth(i).selectOption(item.funding);
    await page.locator("input[type=file]:not([capture])").nth(i).setInputFiles(path.join(tmp, `receipt-${item.receipt}.jpg`));
  }
  await page.waitForFunction(() => !document.body.innerText.includes("Uploading"), null, { timeout: 30000 }).catch(() => {});
  await sleep(1000);
  const card = (title) => page.locator("section", { has: page.locator("h2", { hasText: title }) }).first();
  if (capture) {
    await shot(page, persona, "about-you", { element: card("About you") });
    await shot(page, persona, "what-for", { element: card("What was it for") });
    await shot(page, persona, "receipt-line", { element: page.locator("div.card", { has: page.locator("h3", { hasText: "Line 1" }) }).first() });
    await shot(page, persona, "totals", { element: card("Totals") });
  }
  await page.click("text=Preview and sign");
  await page.waitForSelector("text=Check and sign", { timeout: 60000 });
  await sleep(2000);
  if (capture) {
    await showPreview(page, tmp);
    await shot(page, persona, "check-and-sign");
  }
  await page.fill("#typedName", p.name);
  await page.check("input[type=checkbox]");
  await page.click("text=Sign and submit");
  await page.waitForSelector("text=View request", { timeout: 60000 });
  await sleep(500);
  await shot(page, persona, `done-${mode}`);
  await page.click("text=View request");
  await page.waitForSelector("text=Open signed PDF");
  await sleep(500);
  await shot(page, persona, `request-${mode}`);
  if (capture) {
    await page.goto(BASE + "/requests");
    await page.waitForSelector("h1:has-text('My requests')");
    await sleep(500);
    if (persona === "teacher") await shot(page, persona, "stipends", { element: page.locator("section.card", { hasText: "stipends" }).first() });
    await shot(page, persona, "my-requests");
  }
}

async function pass(browser, mode, capture, tmp) {
  await seedData();
  const server = startServer(mode);
  try {
    await waitForServer();
    for (const [persona, p] of Object.entries(personas)) {
      const ctx = await newContext(browser);
      const page = await signIn(ctx, persona, p, capture);
      await submitRequest(page, persona, p, { mode, capture, tmp });
      await ctx.close();
      console.log(`${mode}: ${persona} done`);
    }
  } finally {
    await stopServer(server);
  }
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "help-shots-"));
for (const persona of Object.keys(personas)) await fs.mkdir(path.join(OUT, persona), { recursive: true });
const browser = await chromium.launch();
try {
  for (const [name, r] of Object.entries(receipts)) await makeReceipt(browser, path.join(tmp, `receipt-${name}.jpg`), r);
  await pass(browser, "ap", true, tmp);
  await pass(browser, "requester", false, tmp);
} finally {
  await browser.close();
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.rm(path.join(ROOT, DATA_DIR), { recursive: true, force: true });
}
console.log("screenshots written to src/images/help");
