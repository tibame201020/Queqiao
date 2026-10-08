import { chromium, type BrowserContext } from "playwright-core";
import { decodeBrowserSessionCapsule } from "./session-capsule.js";

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
  await page.waitForTimeout(12_000);

  const url = page.url();
  const title = await page.title();
  const loginLink = await page.getByRole("link", { name: /log in|登入/i }).count().catch(() => 0);
  const signupLink = await page.getByRole("link", { name: /sign up|註冊/i }).count().catch(() => 0);
  const composer = await page.locator('textarea,[contenteditable="true"]').count().catch(() => 0);
  const body = await page.locator("body").innerText().catch(() => "");
  const waitPage = /請稍候|just a moment|checking your browser/i.test(`${title} ${body.slice(0, 1000)}`);
  const loggedIn = !/\/auth\//i.test(url) && loginLink === 0 && signupLink === 0 && composer > 0 && !waitPage;

  const result = {
    loggedIn,
    url,
    title,
    loginLink,
    signupLink,
    composer,
    waitPage,
    cookieCount: state.cookies.length,
    originCount: state.origins.length,
  };
  console.log(JSON.stringify(result));

  if (!loggedIn) throw new Error("ChatGPT session portability check failed");
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
