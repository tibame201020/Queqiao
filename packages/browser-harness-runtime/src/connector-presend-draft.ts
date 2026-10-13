export type ConnectorDraftSignals={
 editorFocused:boolean;middleInEditor:boolean;tailInEditor:boolean;editorEnabled:boolean;
};
/** A single key press is permitted only if the normal Composer owns the public draft. */
export function assessConnectorDraft(s:ConnectorDraftSignals):"ready"|"unconfirmed"{
 return s.editorFocused&&s.middleInEditor&&s.tailInEditor&&s.editorEnabled?"ready":"unconfirmed";
}
