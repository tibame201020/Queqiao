/** Bounded semantic wait; caller owns the timeout. Never emits a raw browser error. */
export async function observeGate3Composer(probe:{
 waitForVisible:()=>Promise<void>;isVisible:()=>Promise<boolean>;isEnabled:()=>Promise<boolean>;
}):Promise<{editorVisible:boolean;editorEnabled:boolean}>{
 try{await probe.waitForVisible();}catch{/* bounded visibility wait ended */}
 const editorVisible=await probe.isVisible().catch(()=>false);
 const editorEnabled=await probe.isEnabled().catch(()=>false);
 return {editorVisible,editorEnabled};
}
