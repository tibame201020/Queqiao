import { chromium, type BrowserContext } from "playwright-core";
import {runGate2Prompt} from "./gate2-prompt.js";
import {runGate3Prompt} from "./gate3-prompt.js";
import { decodeBrowserSessionCapsule, resolveBrowserSessionCapsule } from "./session-capsule.js";
import { classifySessionPage, type SessionPageSignals, type SessionPageVerdict } from "./session-verdict.js";
import { summarizeCookieRestore, summarizeStorageRestore } from "./session-restore-diagnostics.js";
import { assessSessionComparison, probeUnauthenticatedControl } from "./session-control.js";
import { readSessionEvidence, type SessionEvidence } from "./session-auth-evidence.js";
import {createHttpDiagnostics,failedNavigation,summarizeNavigation,summarizeCookieExpiry,type NavigationSummary} from "./session-http-diagnostics.js";
import {compareRestoredContexts,probeRestoredContext,type RestoredContextProbe} from "./session-restored-control.js";

const capsule = resolveBrowserSessionCapsule({
  legacy: process.env["CHATGPT_BROWSER_SESSION_CAPSULE"],
  part1: process.env["CHATGPT_BROWSER_SESSION_CAPSULE_PART_1"],
  part2: process.env["CHATGPT_BROWSER_SESSION_CAPSULE_PART_2"],
});


const cdpUrl = process.env["BROWSER_CDP_URL"] ?? "http://127.0.0.1:9555";
const state = decodeBrowserSessionCapsule(capsule);

const browser = await chromium.connectOverCDP(cdpUrl);
try {
  const context = browser.contexts()[0];
  if (!context) throw new Error("Browser Harness CDP context is unavailable");
  // Same GitHub Runner and Chrome, but fresh independent incognito Context.
  // Do this before restoring any capsule to the existing default context.
  const control = await probeUnauthenticatedControl(browser);

  // A valid decoded capsule alone does not prove Chrome retained it.
  // Compare cookie values in memory, then report ONLY aggregate counts.
  try {
    await context.addCookies(state.cookies);
  } catch {
    throw new Error("Browser refused session cookie restore");
  }
  const beforeNavigation = summarizeCookieRestore(state.cookies, await context.cookies(), Date.now());
  await installLocalStorage(context);

  const page = context.pages()[0] ?? await context.newPage();
  const http=createHttpDiagnostics();
  page.on("response",response=>http.observe(response.url(),response.status()));
  let navigation:NavigationSummary=failedNavigation();
  let navigationFailed=false;
  try {
    const response=await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 30_000 });
    navigation=summarizeNavigation(response);
  } catch {
    // Do not print raw browser errors: request URLs may contain private data.
    navigationFailed=true;
  }
  // Allow a normal page load to settle. Do not interact with or attempt to bypass browser challenges.
  const deadline = Date.now() + 45_000;
  let sessionEvidence:SessionEvidence={sessionConfirmed:false,check:"not_checked"};
  let sessionEvidenceChecked=false;
  let verdict: SessionPageVerdict = "pending";
  let last: SessionPageSignals = {
    url: page.url(),
    title: "",
    loginLinks: 0,
    signupLinks: 0,
    composerCount: 0,
  };

  while (!navigationFailed && Date.now() < deadline) {
    last = {
      url: page.url(),
      title: await page.title().catch(() => ""),
      loginLinks: await page.getByRole("link", { name: /log in|登入/i }).count().catch(() => 0),
      signupLinks: await page.getByRole("link", { name: /sign up|註冊/i }).count().catch(() => 0),
      composerCount: await page.locator('textarea,[contenteditable="true"]').count().catch(() => 0),
    };
    // A guest Composer is not login proof (verified by the empty CI control).
    // Consult the first-party website's read-only session-status route only
    // when a Composer is visible and there is no challenge or sign-in page.
    if(!sessionEvidenceChecked && classifySessionPage(last)==="guest_composer"){
      sessionEvidenceChecked=true;
      sessionEvidence=await readSessionEvidence(page);
    }
    last.sessionConfirmed=sessionEvidence.sessionConfirmed;
    verdict=classifySessionPage(last);
    if (verdict === "authenticated" || verdict === "logged_out" || verdict==="guest_composer") break;
    await page.waitForTimeout(1_500);
  }

  const afterNavigation = summarizeCookieRestore(state.cookies, await context.cookies(), Date.now());
  // storageState() remains local to this process. Never emit it to CI logs
  // or artifacts; only compare the ChatGPT origin's aggregate entries.
  const observedStorage = await context.storageState().then(
    (snapshot) => ({ readable: true, origins: snapshot.origins }),
    () => ({ readable: false, origins: [] }),
  );
  const localStorage = summarizeStorageRestore(state.origins, observedStorage.origins);
  // One additional same-Runner comparison only when the default restored
  // Context failed with challenge but the guest control loaded.
  // Never retry, rotate network, or interact with the browser challenge.
  let restoredContext:RestoredContextProbe|null=null;
  let restoredContextError=false;
  if(verdict==="browser_challenge" && control.verdict==="guest_composer"){
    try{
      restoredContext=await probeRestoredContext(browser,state,installLocalStorage);
    }catch{
      // Return a sanitized failure rather than raw browser/profile errors.
      restoredContextError=true;
    }
  }  const result = {
    verdict,
    control,
    comparison: assessSessionComparison(control,verdict),
    restoredContext,
    restoredContextError,
    restoredComparison:restoredContext ? compareRestoredContexts(verdict,navigation.status,restoredContext) : "not_run",
    sessionEvidence,
    navigation,
    http:http.snapshot(),
    cookieExpiry:summarizeCookieExpiry(state.cookies,Date.now()),
    loggedIn: verdict === "authenticated",
    urlHost: new URL(last.url).hostname,
    loginLink: last.loginLinks,
    signupLink: last.signupLinks,
    composer: last.composerCount,
    waitPage: verdict === "browser_challenge",
    cookieCount: state.cookies.length,
    originCount: state.origins.length,
    restore: {
      beforeNavigation,
      afterNavigation,
      localStorage,
      storageStateReadable: observedStorage.readable,
    },
  };
  console.log(JSON.stringify(result));

  if (verdict !== "authenticated") {
    throw new Error(`CHATGPT_${verdict.toUpperCase()}`);
  }
  // Gate 2 and Gate 3 are mutually exclusive. No ambiguous multi-send dispatch.
  if(process.env["CHATGPT_BROWSER_GATE2"]==="1" && process.env["CHATGPT_BROWSER_GATE3"]==="1")
    throw Error("BROWSER_GATE_CONFLICT");
  if(process.env["CHATGPT_BROWSER_GATE2"]==="1") {
    const receipt=await runGate2Prompt(page,sessionEvidence.sessionConfirmed===true);
    console.log(JSON.stringify(receipt));
  }
  if(process.env["CHATGPT_BROWSER_GATE3"]==="1") {
    const receipt=await runGate3Prompt(page,sessionEvidence.sessionConfirmed===true);
    console.log(JSON.stringify(receipt));
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
