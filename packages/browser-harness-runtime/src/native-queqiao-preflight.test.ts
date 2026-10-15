import {describe,it,expect} from 'vitest';
import {assessNativeQueqiaoCandidate} from './native-queqiao-preflight.js';
const base={sessionConfirmed:true,selectorVisible:true,optionCount:1,menuitemCount:0,baselineButtonVisible:false,newButtonCount:0};
describe('#185 CI session native Queqiao readonly preflight (never model-call proof)',()=>{
 it('permits exactly one visibly scoped app option, but only reports candidate visibility, never an MCP connection',()=>{
  expect(assessNativeQueqiaoCandidate(base)).toEqual({schema:'queqiao.ci-native-preflight.v1',candidate:'visible',selection:'option',
   connectedMcp:false,nativeToolCallObserved:false,gatePassed:false});
 });
 it('rejects guest, unscoped text, absent/ambiguous options and pre-existing buttons',()=>{
  for(const v of [{sessionConfirmed:false},{selectorVisible:false},{optionCount:0},{optionCount:2},
    {menuitemCount:1},{optionCount:0,menuitemCount:0,newButtonCount:2},
    {optionCount:0,menuitemCount:0,newButtonCount:1,baselineButtonVisible:true}]){
   expect(assessNativeQueqiaoCandidate({...base,...v}).candidate).toBe('not_observed');
  }
 });
 it('accepts a sole newly appeared candidate button only as a visible option, not a tool call',()=>{
  expect(assessNativeQueqiaoCandidate({...base,selectorVisible:false,optionCount:0,newButtonCount:1})).toMatchObject({
   candidate:'visible',selection:'differential_button',connectedMcp:false,gatePassed:false});
 });
});
