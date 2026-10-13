import {describe,it,expect} from "vitest";
import {classifyPostsendStructure,type PostsendStructureSignals} from "./connector-postsend-structure.js";
const empty:PostsendStructureSignals={
 mainVisible:true,visibleUserContainer:false,mainHasPublicMiddle:false,mainHasPublicTail:false,
 bodyHasPublicMiddle:false,bodyHasPublicTail:false,assistantSurfaceVisible:false,dialogVisible:false,
 challengeVisible:false,
};
describe("G3.3 post-send bounded structural observation",()=>{
 it("does not classify an empty view as delivery or Connector success",()=>{
  expect(classifyPostsendStructure(empty)).toBe("no_visible_public_turn");
 });
 it("separates body text outside user role from a native user container",()=>{
  expect(classifyPostsendStructure({...empty,bodyHasPublicMiddle:true,bodyHasPublicTail:true}))
   .toBe("public_text_outside_user_role");
  expect(classifyPostsendStructure({...empty,visibleUserContainer:true,mainHasPublicMiddle:true,mainHasPublicTail:true}))
   .toBe("native_user_candidate");
 });
 it("separates refusal/challenge surfaces and Assistant without a visible user turn",()=>{
  expect(classifyPostsendStructure({...empty,dialogVisible:true})).toBe("dialog_observed");
  expect(classifyPostsendStructure({...empty,challengeVisible:true})).toBe("challenge_observed");
  expect(classifyPostsendStructure({...empty,assistantSurfaceVisible:true})).toBe("assistant_without_confirmed_user_turn");
 });
 it("never emits verified from structural observations alone",()=>{
  expect(classifyPostsendStructure({...empty,visibleUserContainer:true,mainHasPublicMiddle:true,mainHasPublicTail:true}))
   .not.toBe("verified");
  expect(Object.keys(empty)).toEqual(["mainVisible","visibleUserContainer","mainHasPublicMiddle","mainHasPublicTail",
   "bodyHasPublicMiddle","bodyHasPublicTail","assistantSurfaceVisible","dialogVisible","challengeVisible"]);
 });
});
