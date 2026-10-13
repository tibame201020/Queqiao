export type AbEvidencePair={
 a:{runId:string;headSha:string;userTurnObserved:boolean;assistantCompleted:boolean};
 b:{runId:string;headSha:string;appSelected:boolean;userTurnObserved:boolean;toolReceiptVerified:boolean};
};
export type AbContrastVerdict=
 "invalid_pair"|"no_app_control_failed"|"app_selection_unverified"|
 "app_enabled_user_turn_unconfirmed"|"connector_unverified"|"candidate_for_provider_review";
/** An evidence classifier, NOT a GitHub App implementation or an autonomous-Connector grant.
 * Provider-specific execution and independent SHA evidence must be reviewed separately. */
export function classifyAbEvidence(p:AbEvidencePair):AbContrastVerdict{
 const validSha=(s:string)=>/^[a-f0-9]{40}$/.test(s);
 const validRun=(s:string)=>/^\d{1,20}$/.test(s);
 if(!validRun(p.a.runId)||!validRun(p.b.runId)||p.a.runId===p.b.runId||
    !validSha(p.a.headSha)||p.a.headSha!==p.b.headSha)return "invalid_pair";
 if(!p.a.userTurnObserved||!p.a.assistantCompleted)return "no_app_control_failed";
 if(!p.b.appSelected)return "app_selection_unverified";
 if(!p.b.userTurnObserved)return "app_enabled_user_turn_unconfirmed";
 if(!p.b.toolReceiptVerified)return "connector_unverified";
 return "candidate_for_provider_review";
}
