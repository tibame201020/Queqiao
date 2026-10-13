export type UserTurnStructureSignals={
 conversationCreated:boolean;
 userRoleVisible:boolean;
 middleInUserRole:boolean;
 tailInUserRole:boolean;
 middleOutsideEditor:boolean;
 tailOutsideEditor:boolean;
 assistantOwnedFragment:boolean;
 composerRetainsTail:boolean;
};
/** An @mention may split the start of the submitted text. Only native user-owned
 * independently matching PUBLIC middle and tail fragments establish a user turn.
 * Generic visible text / model replies are never sufficient. */
export function classifyUserTurnStructure(s:UserTurnStructureSignals):"user_turn_confirmed"|"unconfirmed"{
 return s.conversationCreated&&s.userRoleVisible&&s.middleInUserRole&&s.tailInUserRole&&
  s.middleOutsideEditor&&s.tailOutsideEditor&&!s.assistantOwnedFragment&&!s.composerRetainsTail
  ?"user_turn_confirmed":"unconfirmed";
}
