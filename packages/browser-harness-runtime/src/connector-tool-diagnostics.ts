export type ConnectorToolSignals={
 githubCardVisible:boolean;genericToolCardVisible:boolean;
 assistantShaVisible:boolean;assistantUnavailableVisible:boolean;
};
export type ConnectorToolDiagnostic="github_card_observed"|"tool_card_unattributed"|"assistant_sha_without_tool"|"assistant_unavailable_without_tool"|"no_observed_reply";
/** Diagnostic only: even a GitHub-labeled UI card still needs independent tool lineage and exact SHA verification. */
export function classifyConnectorToolObservation(s:ConnectorToolSignals):ConnectorToolDiagnostic{
 if(s.githubCardVisible&&s.genericToolCardVisible)return "github_card_observed";
 if(s.genericToolCardVisible)return "tool_card_unattributed";
 if(s.assistantUnavailableVisible)return "assistant_unavailable_without_tool";
 if(s.assistantShaVisible)return "assistant_sha_without_tool";
 return "no_observed_reply";
}
