export type ConnectorComposerObservation={editorVisible:boolean;editorEnabled:boolean};
/** Normal UI readiness only: a single bounded visibility wait before any App choice or send. */
export async function observeConnectorComposer(adapter:{
 waitForVisible:()=>Promise<void>;isVisible:()=>Promise<boolean>;isEnabled:()=>Promise<boolean>;
}):Promise<ConnectorComposerObservation>{
 await adapter.waitForVisible().catch(()=>{});
 return {editorVisible:await adapter.isVisible().catch(()=>false),
         editorEnabled:await adapter.isEnabled().catch(()=>false)};
}
