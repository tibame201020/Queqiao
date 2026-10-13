export type ConnectorPostsendSignals={
 userTurnVisible:boolean;assistantSurfaceVisible:boolean;stopVisible:boolean;
 composerEnabled:boolean;dialogVisible:boolean;
};
export type ConnectorPostsendDiagnostic=
 "user_turn_unconfirmed"|"dialog_observed"|"generation_in_progress"|
 "assistant_surface_without_tool"|"user_turn_without_assistant";
/** Diagnostic only; no state here can assert an actual Connector tool call. */
export function classifyConnectorPostsendState(v:ConnectorPostsendSignals):ConnectorPostsendDiagnostic{
 if(!v.userTurnVisible)return "user_turn_unconfirmed";
 if(v.dialogVisible)return "dialog_observed";
 if(v.stopVisible)return "generation_in_progress";
 if(v.assistantSurfaceVisible)return "assistant_surface_without_tool";
 return "user_turn_without_assistant";
}
