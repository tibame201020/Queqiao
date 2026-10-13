export type ConnectorUserTurnSignals={
 conversationCreated:boolean;promptEchoOutsideEditor:boolean;promptStillInEditor:boolean;
};
/** A key press does not prove submission. A displayed user turn must be observed. */
export function assessConnectorUserTurn(s:ConnectorUserTurnSignals):"confirmed"|"unconfirmed"{
 return s.conversationCreated&&s.promptEchoOutsideEditor&&!s.promptStillInEditor?"confirmed":"unconfirmed";
}
