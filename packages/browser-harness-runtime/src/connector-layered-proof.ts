export function makeReadMarker(runId:string,attempt:string):string{
 if(!/^\d{1,20}$/.test(runId)||!/^\d{1,20}$/.test(attempt))throw Error("invalid_run_marker");
 return `QG3-${runId}-${attempt}`;
}
/** Public marker belongs to the USER prompt, not the SHA-only reply. */
export function makeReadPrompt(marker:string):string{
 if(!/^QG3-\d{1,20}-\d{1,20}$/.test(marker))throw Error("invalid_run_marker");
 return "Using the connected GitHub App only, READ the current default-branch HEAD commit SHA of public tibame201020/Queqiao. "+
  "Do not use web search. Do not modify, create, publish, delete or approve anything. "+
  "Trace marker: "+marker+". This marker identifies the public test request; do not repeat it in your reply. "+
  "If the GitHub App is unavailable, say UNAVAILABLE. Reply with ONLY the exact 40 lowercase hexadecimal characters of that HEAD SHA.";
}
export type ReadLayerSignals={
 appSelected:boolean;conversationCreated:boolean;markerOutsideComposer:boolean;composerCleared:boolean;
 reply:string;replyOutsideUserAndComposer:boolean;replyStable:boolean;expectedSha:string;
 toolUiObserved:boolean;providerReceiptVerified:boolean;
};
export type ReadLayers={l1:"confirmed"|"unconfirmed";l2:"confirmed"|"unconfirmed";l3:"verified"|"not_proved";toolUiObserved:boolean};
/** A UI tool card or matching model output alone is never a provider execution receipt. */
export function assessReadLayers(s:ReadLayerSignals):ReadLayers{
 const l1=s.appSelected&&s.conversationCreated&&s.markerOutsideComposer&&s.composerCleared;
 const l2=l1&&s.replyOutsideUserAndComposer&&s.replyStable&&
  /^[a-f0-9]{40}$/.test(s.expectedSha)&&/^[a-f0-9]{40}$/.test(s.reply)&&s.reply===s.expectedSha;
 return {l1:l1?"confirmed":"unconfirmed",l2:l2?"confirmed":"unconfirmed",
  l3:l2&&s.providerReceiptVerified?"verified":"not_proved",toolUiObserved:s.toolUiObserved};
}
/** Revisit only the existing conversation through the normal UI; never re-submit. */
export function shouldReloadConversation(s:{
 conversationCreated:boolean;reloaded:boolean;generating:boolean;composerReady:boolean;sameConversationUrl:boolean;
}):boolean{
 return s.conversationCreated&&!s.reloaded&&!s.generating&&s.composerReady&&s.sameConversationUrl;
}
