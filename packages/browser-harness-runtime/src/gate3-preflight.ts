export type Gate3PreflightSignals={
 sessionConfirmed:boolean;blankStart:boolean;editorVisible:boolean;editorEnabled:boolean;
};
export type Gate3PreflightVerdict="ready"|"not_authenticated"|"not_blank"|"composer_hidden"|"composer_disabled";
/** Pure first-party observation policy. Never receives URLs, DOM text or credentials. */
export function assessGate3Preflight(s:Gate3PreflightSignals):Gate3PreflightVerdict{
 if(!s.sessionConfirmed)return "not_authenticated";
 if(!s.blankStart)return "not_blank";
 if(!s.editorVisible)return "composer_hidden";
 if(!s.editorEnabled)return "composer_disabled";
 return "ready";
}
