import { writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { validatePublicBrowserReceipt } from "./public-browser-verdict.js";

/** Isolated Actions Chrome test: no ChatGPT sessions or persisted browser profiles. */
const runId = process.env["GITHUB_RUN_ID"];
const output = process.env["BROWSER_RECEIPT_PATH"];
const cdp = process.env["BROWSER_CDP_URL"] ?? "http://127.0.0.1:9555";
if (!runId || !output) throw new Error("Missing CI run correlation or artifact path");
const endpoint = new URL(cdp);
if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) {
  throw new Error("Browser CDP endpoint must be loopback");
}
const browser = await chromium.connectOverCDP(cdp);
try {
  const context = browser.contexts()[0];
  if (!context) throw new Error("No ephemeral Chrome CDP context");
  const page = await context.newPage();
  try {
    await page.goto("https://example.com/", { waitUntil: "domcontentloaded", timeout: 30_000 });
    const pageTitle = await page.title();
    const origin = new URL(page.url()).origin;
    const html = [
      '<!doctype html><html><head><title>Isolated CI Harness</title></head>',
      '<body><label for="check">Synthetic input</label><input id="check" />',
      '<button id="run" type="button">Execute synthetic DOM action</button>',
      '<output id="result"></output><script>',
      'let clicks = 0;',
      'document.querySelector("#run").addEventListener("click", () => {',
      'clicks += 1;',
      'const value = document.querySelector("#check").value;',
      'document.querySelector("#result").textContent =',
      'value === "CI-only-synthetic-input" && clicks === 1',
      '? "QUEQIAO_CI_BROWSER_HARNESS_OK" : "INVALID";',
      'document.querySelector("#result").dataset.clicks = String(clicks);',
      'document.querySelector("#result").dataset.inputEcho = value;',
      '});</script></body></html>'
    ].join("");
    await page.setContent(html);
    await page.locator("#check").fill("CI-only-synthetic-input");
    await page.locator("#run").click();
    const receipt = validatePublicBrowserReceipt({
      runId, origin, pageTitle,
      interactiveMarker: await page.locator("#result").textContent(),
      clicks: Number(await page.locator("#result").getAttribute("data-clicks")),
      inputEcho: await page.locator("#result").getAttribute("data-input-echo"),
      headless: true,
    });
    await writeFile(output, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    console.log("QUEQIAO_CI_BROWSER_HARNESS_OK");
    console.log("Verified synthetic CDP browser interaction for GitHub run " + receipt.runId);
  } finally {
    await page.close();
  }
} finally {
  await browser.close();
}
