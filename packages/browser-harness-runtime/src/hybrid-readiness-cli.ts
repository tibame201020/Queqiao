import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { classifySessionPage, type SessionPageVerdict } from "./session-verdict.js";
import { classifyHybridReadiness } from "./hybrid-readiness.js";

async function browserReadiness(): Promise<SessionPageVerdict | "unreachable"> {
  const cdp = process.env["BROWSER_CDP_URL"] ?? "http://127.0.0.1:9333";
  const address = new URL(cdp);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(address.hostname)) {
    throw new Error("Browser CDP endpoint must be local loopback");
  }
  try {
    const browser = await chromium.connectOverCDP(cdp, { timeout: 7_000 });
    try {
      const context = browser.contexts()[0];
      const page = context?.pages().find((entry) => {
        try { return new URL(entry.url()).hostname === "chatgpt.com"; }
        catch { return false; }
      });
      if (!page) return "pending";
      return classifySessionPage({
        url: page.url(),
        title: await page.title(),
        loginLinks: await page.getByRole("link", { name: /log in|登入/i }).count(),
        signupLinks: await page.getByRole("link", { name: /sign up|註冊/i }).count(),
        composerCount: await page.locator('textarea,[contenteditable="true"]').count(),
      });
    } finally {
      await browser.close();
    }
  } catch {
    return "unreachable";
  }
}

async function managementReadiness(): Promise<number | null> {
  const secretPath = process.env["QUEQIAO_GATEWAY_MANAGEMENT_SECRET_FILE"];
  if (!secretPath) return null;
  const management = new URL(process.env["QUEQIAO_GATEWAY_MANAGEMENT_URL"] ?? "http://127.0.0.1:12990");
  if (management.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(management.hostname)) {
    throw new Error("Gateway management endpoint must be local loopback HTTP");
  }
  try {
    const secret = (await readFile(secretPath, "utf8")).trim();
    if (!secret) return null;
    const response = await fetch(new URL("/runtimes", management), {
      headers: { "x-queqiao-management-secret": secret },
      signal: AbortSignal.timeout(7_000),
    });
    return response.status;
  } catch {
    return null;
  }
}

const [browser, managementStatus] = await Promise.all([browserReadiness(), managementReadiness()]);
const result = classifyHybridReadiness({ browser, managementStatus });
console.log(JSON.stringify({ browser, providerAvailable: managementStatus === 200, ...result }));
if (!result.ready) process.exitCode = 2;
