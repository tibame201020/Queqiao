export type ConnectorReadVerdict="verified"|"app_not_selected"|"tool_not_observed"|"result_mismatch";
export function assessConnectorReadProof(input:{
 appSelected:boolean;toolObserved:boolean;reply:string;expectedSha:string;
}):ConnectorReadVerdict{
 if(!input.appSelected)return "app_not_selected";
 if(!input.toolObserved)return "tool_not_observed";
 if(!/^[a-f0-9]{40}$/.test(input.expectedSha) ||
    !/^[a-f0-9]{40}$/.test(input.reply.trim()) ||
    input.reply.trim()!==input.expectedSha)return "result_mismatch";
 return "verified";
}
