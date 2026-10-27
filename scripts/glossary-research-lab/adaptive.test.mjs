import test from 'node:test';
import assert from 'node:assert/strict';
import {splitLocations,passageExcluded,coverageSignal,scoutPool,cliticCandidates,POLICY} from './adaptive.mjs';
const passage=(id,text,paragraph)=>({itemId:String(id),text,occurrences:[{start:0,end:4}],reference:{title:'book',chapter:'chapter',paragraph,url:'https://corpus.local/doc/book?line='+paragraph}});
test('location holdout suppresses adjacent paragraphs and contained text, without excluding another chapter',()=>{
 const held=passage(1,'a complete source passage',5);
 assert.equal(passageExcluded(passage(2,'different adjacent passage',6),[held]),true);
 assert.equal(passageExcluded(passage(3,'a complete source passage with context',20),[held]),true);
 assert.equal(passageExcluded({...passage(2,'different adjacent passage',6),reference:{...held.reference,chapter:'other',paragraph:6}},[held]),false);
 const split=splitLocations(Array.from({length:100},(_,i)=>passage(i,'source '+i+'; a complete distinct passage.',i*4)),42);
 assert.equal(split.evaluation.length,40);assert.equal(split.research.length,60);assert.equal(split.overlap,0);
 assert.ok(split.research.every(p=>!passageExcluded(p,split.evaluation)));
 assert.equal(splitLocations([held],42).overlap,1);
});
test('novel source contexts trigger while repetitions and sparse samples bypass',()=>{
 const initial=[passage(1,'term casa tierra vida alma',1)];
 const repeated=Array.from({length:30},(_,i)=>passage(i,'term casa tierra vida alma',i));
 assert.equal(coverageSignal(repeated,initial,['term']).trigger,false);
 const different=[...repeated,...Array.from({length:10},(_,i)=>passage(i+30,'term distinta palabra misterio signo',i))];
 assert.equal(coverageSignal(different,initial,['term']).trigger,true);
 assert.equal(coverageSignal(different.slice(-3),initial,['term']).trigger,false);
});
test('bounded scout keeps rare novel contexts and has reproducible ids',()=>{
 const pool=Array.from({length:1000},(_,i)=>passage(i,'term text '+i,i));
 const signal={rankedNovel:pool.slice(700,900)};
 const a=scoutPool(pool,signal,42),b=scoutPool(pool,signal,42);
 assert.deepEqual(a,b);assert.equal(a.length,POLICY.scoutCap);assert.equal(new Set(a.map(p=>p.itemId)).size,a.length);
 assert.ok(a.some(p=>p.itemId==='700'));
});
test('attached pronouns are candidates only; no derivative expansion',()=>{
 assert.ok(cliticCandidates(['regenerar']).includes('regenerarse'));
 assert.equal(cliticCandidates(['regeneración']).length,0);
});
