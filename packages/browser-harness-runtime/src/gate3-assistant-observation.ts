export function isGate3AssistantCandidate(input:{text:string;prompt:string;isUserTurn:boolean}):boolean{
 const text=input.text.trim();
 // The synthetic request names keys but never contains a JSON key/value pair.
 // Model output is only a candidate here, not an accepted or completed answer.
 return !input.isUserTurn && text!==input.prompt.trim() &&
  text.length>0 && text.length<=1600 && /"(?:concept|verification|limitation)"\s*:/.test(text);
}
export function assessGate3AssistantSignals(input:{
 candidateObserved:boolean;stable:boolean;stopVisible:boolean;composerReady:boolean;
}):"not_observed"|"generating"|"completed"{
 if(!input.candidateObserved)return "not_observed";
 if(!input.stable||input.stopVisible||!input.composerReady)return "generating";
 return "completed";
}
