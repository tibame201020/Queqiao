import {describe,it,expect} from 'vitest';
import {assessNativeQueqiaoDifferential} from './native-queqiao-preflight.js';
describe('#185 independent read-only positive control for restored ChatGPT app-picker',()=>{
 it('isolates a missing Queqiao candidate when the same session visibly offers the known GitHub app',()=>{
  expect(assessNativeQueqiaoDifferential('not_observed','visible')).toEqual({
   diagnostic:'queqiao_specific_candidate_not_observed',nativeToolCallObserved:false,gatePassed:false,
  });
 });
 it('does not infer plugin absence when neither native app candidate is observable',()=>{
  expect(assessNativeQueqiaoDifferential('not_observed','not_observed').diagnostic).toBe('native_picker_not_proven');
  expect(assessNativeQueqiaoDifferential('visible','not_observed').diagnostic).toBe('queqiao_ui_candidate_visible');
  expect(assessNativeQueqiaoDifferential('not_observed','not_checked').diagnostic).toBe('positive_control_not_checked');
 });
});
