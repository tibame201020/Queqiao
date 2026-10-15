import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import type {Page,Locator} from 'playwright-core';
import {assessNativeQueqiaoCandidate} from './native-queqiao-preflight.js';

const target=/^Queqiao(?:\b|[-\s])/i;
async function cappedVisible(loc:Locator){
 const n=Math.min(await loc.count(),3);let seen=0;
 for(let i=0;i<n;i++)if(await loc.nth(i).isVisible().catch(()=>false))seen++;
 return Math.min(seen,2);
}
/** No Send, no tool invocation, no screenshot, no URLs, no app inventory. */
export async function runNativeQueqiaoPreflight(page:Page,sessionConfirmed:boolean){
 const path=process.env['NATIVE_QUEQIAO_PREFLIGHT_RECEIPT_PATH'];
 const runId=process.env['GITHUB_RUN_ID']??'';
 const attempt=process.env['GITHUB_RUN_ATTEMPT']??'';
 if(!path||!/^\d{1,20}$/.test(runId)||!/^\d{1,8}$/.test(attempt))
  throw Error('NATIVE_QUEQIAO_PREFLIGHT_CONTEXT_INVALID');
 let verdict=assessNativeQueqiaoCandidate({sessionConfirmed:false,selectorVisible:false,
  optionCount:0,menuitemCount:0,baselineButtonVisible:false,newButtonCount:0});
 try{
  if(!sessionConfirmed)throw Error('NATIVE_QUEQIAO_AUTH_UNCONFIRMED');
  if(new URL(page.url()).pathname!=='/')throw Error('NATIVE_QUEQIAO_NOT_BLANK_CHAT');
  const editor=page.locator('[contenteditable="true"][role="textbox"]').first();
  await editor.waitFor({state:'visible',timeout:15000});
  if(!await editor.isEnabled())throw Error('NATIVE_QUEQIAO_COMPOSER_UNAVAILABLE');
  const baselineButtonVisible=(await cappedVisible(page.getByRole('button',{name:target})))>0;
  // Only UI suggestions after typing the app mention. Never click or press Enter.
  await editor.fill('@Queqiao');
  await page.waitForTimeout(1200);
  const menu=page.getByRole('menu'),listbox=page.getByRole('listbox'),dialog=page.getByRole('dialog');
  const m=await cappedVisible(menu),l=await cappedVisible(listbox),d=await cappedVisible(dialog);
  const selectorVisible=m+l+d===1;
  const scope=l===1?listbox.first():m===1?menu.first():d===1?dialog.first():page.locator('body');
  const optionCount=selectorVisible?await cappedVisible(scope.getByRole('option',{name:target})):0;
  const menuitemCount=selectorVisible?await cappedVisible(scope.getByRole('menuitem',{name:target})):0;
  const newButtonCount=selectorVisible?0:await cappedVisible(page.getByRole('button',{name:target}));
  verdict=assessNativeQueqiaoCandidate({sessionConfirmed,selectorVisible,optionCount,menuitemCount,
   baselineButtonVisible,newButtonCount});
 }catch{
  // Missing UI or non-confirmed session is evidence of NOT OBSERVED, not permission to retry or scrape.
 }finally{
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const receipt={...verdict,runId,attempt,readOnly:true,appSelectionPerformed:false,submitted:false};
  writeFileSync(path,JSON.stringify(receipt)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});
  console.log(JSON.stringify(receipt));
 }
 if(verdict.candidate!=='visible')throw Error('NATIVE_QUEQIAO_APP_CANDIDATE_NOT_OBSERVED');
}
