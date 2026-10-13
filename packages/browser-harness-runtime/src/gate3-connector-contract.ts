const REPO="tibame201020/signal-notes";
const BRANCH="gate3/synthetic-2026-10-13";
const PR=2;
export const GATE3_CONNECTOR_TARGET={repository:REPO,branch:BRANCH,pr:PR} as const;
export function createGate3ConnectorMarker(runId:string,attempt:string):string{
 if(!/^[1-9]\\d{0,19}$/.test(runId)||! /^[1-9]\\d{0,7}$/.test(attempt))
  throw Error("GATE3_CONNECTOR_INVALID_RUN");
 return `QUEQIAO-GATE3-CONNECTOR-${runId}-${attempt}`;
}
/** Public synthetic marker only. Tool access is NOT assumed or provisioned by CI. */
export function buildGate3ConnectorPrompt(marker:string):string{
 if(!/^QUEQIAO-GATE3-CONNECTOR-[1-9]\\d{0,19}-[1-9]\\d{0,7}$/.test(marker))
  throw Error("GATE3_CONNECTOR_INVALID_MARKER");
 return [
  "This is one authorized synthetic GitHub Connector capability acceptance, not a request for news or personal context.",
  "Use only my already connected GitHub Connector in this ChatGPT session to add exactly one public test comment",
  `to existing Draft PR #${PR} in ${REPO} (test branch ${BRANCH}).`,
  `The entire comment body must equal this exact public marker: ${marker}`,
  "Do not merge, approve, modify files, create branches, publish an article, access private records or request credentials.",
  "Do not use a browser workaround or claim an action that did not actually happen.",
  `After the Connector reports a successful comment, reply with ONLY ${marker}.`,
  "If the GitHub Connector is not available or approval is required, do not attempt an alternative action; reply ONLY UNAVAILABLE.",
 ].join(" ");
}
export type ConnectorEvidence={draft:boolean;head:string;base:string;comments:ReadonlyArray<{body:string;user:{login:string}}>} ;
export function assessGate3ConnectorEvidence(marker:string,e:ConnectorEvidence):
 "verified"|"wrong_target"|"missing_comment"{
 if(!e.draft||e.head!==BRANCH||e.base!=="main")return "wrong_target";
 return e.comments.some(c=>c.body===marker&&c.user?.login==="tibame201020")?"verified":"missing_comment";
}
