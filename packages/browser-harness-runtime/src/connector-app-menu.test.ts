import {describe,it,expect} from "vitest";
import {normalizeAppMenuCounts,selectAppCandidateRole} from "./connector-app-menu.js";

describe("bounded non-identifying native App selector diagnostics",()=>{
 it("exports fixed boolean presence only, never menu content or counts of personal apps",()=>{
  expect(normalizeAppMenuCounts({menu:1,listbox:0,dialog:0,option:0,menuitem:0,button:2,text:3}))
   .toEqual({menuVisible:true,listboxVisible:false,dialogVisible:false,githubOptionVisible:false,
    githubMenuitemVisible:false,githubButtonVisible:true,githubTextVisible:true});
  expect(Object.keys(normalizeAppMenuCounts({menu:0,listbox:0,dialog:0,option:0,menuitem:0,button:0,text:0})))
   .toEqual(["menuVisible","listboxVisible","dialogVisible","githubOptionVisible","githubMenuitemVisible","githubButtonVisible","githubTextVisible"]);
 });
 it("selects only an actual GitHub option/menuitem within a visible selector, never arbitrary text or button",()=>{
  expect(selectAppCandidateRole({menuVisible:true,listboxVisible:false,dialogVisible:false,githubOptionVisible:true,githubMenuitemVisible:false,githubButtonVisible:false,githubTextVisible:true})).toBe("option");
  expect(selectAppCandidateRole({menuVisible:true,listboxVisible:false,dialogVisible:false,githubOptionVisible:false,githubMenuitemVisible:true,githubButtonVisible:false,githubTextVisible:true})).toBe("menuitem");
  expect(selectAppCandidateRole({menuVisible:false,listboxVisible:false,dialogVisible:false,githubOptionVisible:true,githubMenuitemVisible:false,githubButtonVisible:false,githubTextVisible:true})).toBe("none");
  expect(selectAppCandidateRole({menuVisible:true,listboxVisible:false,dialogVisible:false,githubOptionVisible:false,githubMenuitemVisible:false,githubButtonVisible:true,githubTextVisible:true})).toBe("none");
  const buttonOnly={menuVisible:false,listboxVisible:false,dialogVisible:false,githubOptionVisible:false,
   githubMenuitemVisible:false,githubButtonVisible:true,githubTextVisible:true};
  expect(selectAppCandidateRole(buttonOnly,{baselineGithubButtonVisible:false,afterGithubButtonCount:1})).toBe("button");
  expect(selectAppCandidateRole(buttonOnly,{baselineGithubButtonVisible:true,afterGithubButtonCount:1})).toBe("none");
  expect(selectAppCandidateRole(buttonOnly,{baselineGithubButtonVisible:false,afterGithubButtonCount:2})).toBe("none");
  expect(selectAppCandidateRole({...buttonOnly,githubTextVisible:false},{baselineGithubButtonVisible:false,afterGithubButtonCount:1})).toBe("none");

 });
});
