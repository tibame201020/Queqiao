/** Read-only UI discovery candidate. It cannot establish a live MCP connection or tool-call provenance. */
export type NativeQueqiaoSignals={
 sessionConfirmed:boolean;selectorVisible:boolean;optionCount:number;menuitemCount:number;
 baselineButtonVisible:boolean;newButtonCount:number;
};
export function assessNativeQueqiaoCandidate(s:NativeQueqiaoSignals){
 const n=(x:number)=>Number.isInteger(x)&&x>=0&&x<=2;
 let selection:'option'|'menuitem'|'differential_button'|'none'='none';
 if(s.sessionConfirmed&&n(s.optionCount)&&n(s.menuitemCount)&&n(s.newButtonCount)){
  if(s.selectorVisible&&s.optionCount===1&&s.menuitemCount===0)selection='option';
  else if(s.selectorVisible&&s.menuitemCount===1&&s.optionCount===0)selection='menuitem';
  else if(!s.selectorVisible&&s.optionCount===0&&s.menuitemCount===0&&
   !s.baselineButtonVisible&&s.newButtonCount===1)selection='differential_button';
 }
 return {schema:'queqiao.ci-native-preflight.v1' as const,candidate:selection==='none'?'not_observed' as const:'visible' as const,
  selection,connectedMcp:false as const,nativeToolCallObserved:false as const,gatePassed:false as const};
}

/** Paired UI-only control: absence is not proof a plugin is uninstalled. */
export function assessNativeQueqiaoDifferential(
 target:'visible'|'not_observed',control:'visible'|'not_observed'|'not_checked'){
 const diagnostic=target==='visible'?'queqiao_ui_candidate_visible' as const:
  control==='visible'?'queqiao_specific_candidate_not_observed' as const:
  control==='not_checked'?'positive_control_not_checked' as const:'native_picker_not_proven' as const;
 return {diagnostic,nativeToolCallObserved:false as const,gatePassed:false as const};
}
