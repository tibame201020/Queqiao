export type ConnectorPreflightSignals={
 authenticated:boolean;runIdValid:boolean;expectedShaValid:boolean;
 blankStart:boolean;editorVisible:boolean;editorEnabled:boolean;
};
/** A frozen non-identifying set of signals; never include URL, account or browser state. */
export function assessConnectorPreflight(v:ConnectorPreflightSignals):"ready"|"failed"{
 return v.authenticated&&v.runIdValid&&v.expectedShaValid&&v.blankStart&&v.editorVisible&&v.editorEnabled?"ready":"failed";
}
