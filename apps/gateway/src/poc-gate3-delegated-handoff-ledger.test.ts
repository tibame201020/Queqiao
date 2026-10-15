import {readFileSync} from 'node:fs';import {describe,it,expect} from 'vitest';
const d=readFileSync('docs/gate3-full-e2e.md','utf8');
describe('#124 G3.4/G3.5 joined handoff doc acceptance',()=>{
 it('keeps the production and write boundaries while documenting the actual same-run release',()=>{
  for(const s of ['gate3_delegated_handoff','gate3-controller-complete.json','leaseState=disposed','publication=not_observed','fullGatePassed=false','already connected','7-day retention','separately approved fresh-date','not G3.4/G3.5 PASS'])expect(d).toContain(s);
 });
});
