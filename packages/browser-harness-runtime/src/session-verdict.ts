export type SessionPageSignals = {
  url: string;
  title: string;
  loginLinks: number;
  signupLinks: number;
  composerCount: number;
};

export type SessionPageVerdict = "authenticated" | "logged_out" | "browser_challenge" | "pending";

export function classifySessionPage(signals: SessionPageSignals): SessionPageVerdict {
  if (/just a moment|請稍候|checking your browser|verify you are human/i.test(signals.title)) {
    return "browser_challenge";
  }
  if (/\/auth(?:\/|$)|\/login(?:\/|$)|\/signup(?:\/|$)/i.test(new URL(signals.url).pathname)
    || signals.loginLinks > 0 || signals.signupLinks > 0) {
    return "logged_out";
  }
  if (signals.composerCount > 0 && new URL(signals.url).hostname === "chatgpt.com") {
    return "authenticated";
  }
  return "pending";
}
