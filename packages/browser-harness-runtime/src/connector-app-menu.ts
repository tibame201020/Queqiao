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
export function selectAppCandidateRole(v:AppMenuSignals):"option"|"menuitem"|"none"{
 if(!(v.menuVisible||v.listboxVisible||v.dialogVisible))return "none";
 if(v.githubOptionVisible)return "option";
 if(v.githubMenuitemVisible)return "menuitem";
 return "none";
}
