export type PostsendStructureSignals={
 mainVisible:boolean;visibleUserContainer:boolean;mainHasPublicMiddle:boolean;mainHasPublicTail:boolean;
 bodyHasPublicMiddle:boolean;bodyHasPublicTail:boolean;assistantSurfaceVisible:boolean;dialogVisible:boolean;
 challengeVisible:boolean;
};
export type PostsendStructureVerdict=
 "no_visible_public_turn"|"native_user_candidate"|"public_text_outside_user_role"|
 "assistant_without_confirmed_user_turn"|"dialog_observed"|"challenge_observed";
/** Diagnostics only: normal rendered structure does not prove delivery or Connector tool invocation. */
export function classifyPostsendStructure(s:PostsendStructureSignals):PostsendStructureVerdict{
 if(s.challengeVisible)return "challenge_observed";
 if(s.dialogVisible)return "dialog_observed";
 if(s.mainVisible&&s.visibleUserContainer&&s.mainHasPublicMiddle&&s.mainHasPublicTail)return "native_user_candidate";
 if(s.bodyHasPublicMiddle&&s.bodyHasPublicTail)return "public_text_outside_user_role";
 if(s.assistantSurfaceVisible)return "assistant_without_confirmed_user_turn";
 return "no_visible_public_turn";
}
