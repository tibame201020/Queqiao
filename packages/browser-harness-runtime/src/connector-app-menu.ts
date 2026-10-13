export type AppMenuSignals={
 menuVisible:boolean;listboxVisible:boolean;dialogVisible:boolean;
 githubOptionVisible:boolean;githubMenuitemVisible:boolean;
 githubButtonVisible:boolean;githubTextVisible:boolean;
};
export type AppMenuCounts={menu:number;listbox:number;dialog:number;option:number;menuitem:number;button:number;text:number};
/** Disclosure budget: fixed boolean names only. Never return labels, counts, DOM or app inventory. */
export function normalizeAppMenuCounts(v:AppMenuCounts):AppMenuSignals{
 return {
  menuVisible:v.menu>0,listboxVisible:v.listbox>0,dialogVisible:v.dialog>0,
  githubOptionVisible:v.option>0,githubMenuitemVisible:v.menuitem>0,
  githubButtonVisible:v.button>0,githubTextVisible:v.text>0,
 };
}
/** An unrelated button or arbitrary textual mention is not proof of App selection. */
export function selectAppCandidateRole(v:AppMenuSignals,differential?:{baselineGithubButtonVisible:boolean;afterGithubButtonCount:number}):"option"|"menuitem"|"button"|"none"{
 if(!(v.menuVisible||v.listboxVisible||v.dialogVisible)){
  // Normal UI can render a native suggestion as a button, without menu/listbox roles.
  // A single target button must have appeared only as a result of typing @GitHub.
  return differential && !differential.baselineGithubButtonVisible && differential.afterGithubButtonCount===1 &&
   v.githubButtonVisible && v.githubTextVisible ? "button" : "none";
 }
 if(v.githubOptionVisible)return "option";
 if(v.githubMenuitemVisible)return "menuitem";
 return "none";
}
