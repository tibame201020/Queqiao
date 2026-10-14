/** Product-provenance boundary. This pure classifier cannot authenticate a provider log.
 * The trusted producer and original record must come from a separately approved
 * authorized product API/adapter; caller-set booleans are NOT a cryptographic proof.
 * Returning a candidate never changes Browser Harness L3 to verified.
 */
export type L3EvidenceSignals={
 source:"none"|"normal_ui"|"independent_github_read"|"another_chat_tool"|"approved_app_activity_log";
 trustedProducerAvailable:boolean;sourceRecordAuthenticated:boolean;
 sameConversation:boolean;runMarkerMatched:boolean;actionMatched:boolean;resultMatched:boolean;
};
export type L3EvidenceVerdict="source_unavailable"|"not_provider_evidence"|"record_unverified"|
 "correlation_incomplete"|"candidate_for_independent_review";
export function assessL3EvidenceBoundary(s:L3EvidenceSignals):L3EvidenceVerdict{
 if(s.source==="none")return "source_unavailable";
 if(s.source!=="approved_app_activity_log")return "not_provider_evidence";
 if(!s.trustedProducerAvailable)return "source_unavailable";
 if(!s.sourceRecordAuthenticated)return "record_unverified";
 if(!s.sameConversation||!s.runMarkerMatched||!s.actionMatched||!s.resultMatched)
  return "correlation_incomplete";
 return "candidate_for_independent_review";
}
