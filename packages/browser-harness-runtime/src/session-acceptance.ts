import { chromium, type BrowserContext } from "playwright-core";
import { decodeBrowserSessionCapsule } from "./session-capsule.js";
import { classifySessionPage, type SessionPageSignals, type SessionPageVerdict } from "./session-verdict.js";

const capsule = process.env["CHATGPT_BROWSER_SESSION_CAPSULE"];
if (!capsule) throw new Error("CHATGPT_BROWSER_SESSION_CAPSULE is required");

const cdpUrl = process.env["BROWSER_CDP_URL"] ?? "http://127.0.0.1:9555";
const state = decodeBrowserSessionCapsule(capsule);

const browser = await chromium.connectOverCDP(cdpUrl);
try {
  const context = browser.contexts()[0];
  if (!context) throw new Error("Browser Harness CDP context is unavailable");

  await context.addCookies(state.cookies);
  await installLocalStorage(context);

  const page = context.pages()[0] ?? await context.newPage();
  await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 30_000 });
  // Allow a normal page load to settle. Do not interact with or attempt to bypass browser challenges.
  const deadline = Date.now() + 45_000;
  let verdict: SessionPageVerdict = "pending";
  let last: SessionPageSignals = {
    url: page.url(),
    title: "",
    loginLinks: 0,
    signupLinks: 0,
    composerCount: 0,
  };

  while (Date.now() < deadline) {
    last = {
      url: page.url(),
      title: await page.title().catch(() => ""),
      loginLinks: await page.getByRole("link", { name: /log in|登入/i }).count().catch(() => 0),
      signupLinks: await page.getByRole("link", { name: /sign up|註冊/i }).count().catch(() => 0),
      composerCount: await page.locator('textarea,[contenteditable="true"]').count().catch(() => 0),
    };
    verdict = classifySessionPage(last);
    if (verdict === "authenticated" || verdict === "logged_out") break;
    await page.waitForTimeout(1_500);
  }

  const result = {
    verdict,
    loggedIn: verdict === "authenticated",
    urlHost: new URL(last.url).hostname,
    loginLink: last.loginLinks,
    signupLink: last.signupLinks,
    composer: last.composerCount,
    waitPage: verdict === "browser_challenge",
    cookieCount: state.cookies.length,
    originCount: state.origins.length,
  };
  console.log(JSON.stringify(result));

  if (verdict !== "authenticated") {
    throw new Error(`CHATGPT_${verdict.toUpperCase()}`);
  }
} finally {
  await browser.close();
}

async function installLocalStorage(context: BrowserContext): Promise<void> {
  const chatgpt = state.origins.find((origin) => origin.origin === "https://chatgpt.com");
  const entries = Object.fromEntries((chatgpt?.localStorage ?? []).map((entry) => [entry.name, entry.value]));
  await context.addInitScript((payload) => {
    const browser = globalThis as unknown as {
      location: { origin: string };
      localStorage: { setItem(name: string, value: string): void };
    };
    if (browser.location.origin !== payload.origin) return;
    for (const [name, value] of Object.entries(payload.entries)) {
      browser.localStorage.setItem(name, value);
    }
  }, { origin: "https://chatgpt.com", entries });
}
