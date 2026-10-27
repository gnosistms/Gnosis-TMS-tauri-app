"""Reuse the earlier blinded note-comparison reviewer for fresh generated results."""
import argparse,json,os,pathlib,subprocess,hashlib
from ilustre_rerun import HERE,ROOT,RUN,PREVIOUS,read,write
COMPARE=RUN/'comparison'
def prepare():
 state=read(RUN/'study.json');new=read(RUN/'input.json');old=read(PREVIOUS/'input.json')
 for rep in range(1):
  fresh=read(RUN/f'final-reference/rep-{rep}.json');by={x['paragraphId']:x for x in fresh}
  assert len(by)==57
  for bi,batch in enumerate(old['batches']):
   baseline=read(PREVIOUS/f'translation/rep-{rep}/batch-{bi}/long/translations.json')
   write(COMPARE/f'translation/rep-{rep}/batch-{bi}/long/translations.json',baseline)
   write(COMPARE/f'translation/rep-{rep}/batch-{bi}/short/translations.json',[{'id':p['id'],'source':p['text'],'translation':by[p['id']]['translation']}for p in batch])
 # The reviewer adapter reads only these source batches and blind translations.
 write(COMPARE/'input.json',{'batches':old['batches'],'repetitions':1})
 write(COMPARE/'manifest.json',{'terms':[{'source_terms':['ilustre']}],'seed':191019})
 write(COMPARE/'condition-map.json',{'long':'Earlier current full notes and candidates','short':'Freshly researched entry from updated production procedure','notNoteOnly':True,'priorRun':str(PREVIOUS),'newRun':str(RUN),'corpusReference':57,'repetitions':1})
def main():
 p=argparse.ArgumentParser();p.add_argument('phase',choices=['prepare','judge','confirm']);a=p.parse_args()
 if a.phase=='prepare':prepare();print('Blinded comparison prepared');return
 base=(HERE/'lab.mjs').read_text();base=base[:base.index("\ntry{\n if(command==='prepare')")]
 # Reuse the exact calibrated schema, rubric, blinding and confirmation protocol.
 old=(HERE/'ilustre_notes_dispatch.mjs').read_text();chunk=old[old.index('const noteGradeEnum='):old.index("if(command==='translate')")]
 intro="const noteInput=read(`${run}/input.json`);\nconst noteString={type:'string'};const noteObject=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});const noteArray=items=>({type:'array',items});\nconst auth=spawnSync('codex',['login','status'],{encoding:'utf8'});if(!`${auth.stdout}${auth.stderr}`.includes('Logged in using ChatGPT'))throw Error('Subscription required');\n"
 module=HERE/f'.ilustre-rerun-comparison-{os.getpid()}.mjs';module.write_text(base+'\n'+intro+chunk+"\nif(command==='judge')await noteJudge();else if(command==='confirm')await noteConfirm();else throw Error('Unknown phase');\n")
 try:subprocess.check_call(['node',str(module),a.phase,'--run',str(COMPARE),'--workers','1'])
 finally:module.unlink(missing_ok=True)
if __name__=='__main__':main()
