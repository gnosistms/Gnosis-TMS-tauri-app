"""Controls for the uncovered positive planet policy and new errors outside the term."""
import argparse,hashlib,json,os,subprocess
from pathlib import Path
from full_research import HERE,ROOT,read,write

def prepare(language):
    dest=ROOT/language/'extra-calibration'
    if (dest/'freeze.json').exists():return dest
    criteria=read(ROOT/language/'assessment-only/criteria.json')
    items=[]
    def add(case,term,source,good,bad,expected,whole=False):
        for mirror in (False,True):
            gs,bs=('B','A') if mirror else ('A','B')
            items.append({'case':case,'whole':whole,'packet':{'id':f'x{len(items)+1:02}','term':term,'language':language,'source':source,'A':bad if mirror else good,'B':good if mirror else bad,'criteria':criteria[term]},
                          'expected':{k.replace('Good',gs).replace('Bad',bs):v for k,v in expected.items()}})
    controls=read(ROOT/language/'assessment-only/domain-controls.json')
    if language=='vi':
        e=read(ROOT/language/'terms/04/evidence.json')
        p=next(p for p in e['evaluation'] if p['itemId']=='ffd7cb8a91c47d27')
        source=p['text'][p['text'].index('Aquel Astro'):].split(';')[0]
        assert 'planeta' not in source.lower()
        good='Thiên thể du hành ấy, đang đến để “va chạm” với hành tinh Trái Đất của chúng ta, sẽ chen giữa Mặt Trời rực rỡ đang chiếu sáng chúng ta và hành tinh này của chúng ta.'
        add('planet-without-explicit-planeta','mundos',source,good,good.replace('hành tinh','thế giới'),{'accuracyGood':'faithful','accuracyBad':'faithful','policyGood':'pass','policyBad':'fail'})
        c=next(c for c in controls if c['case']=='mundos-category-membership')
        good=c['packet']['A'];assert '13 thế giới' in good
        add('new-number-error-outside-term','mundos',c['packet']['source'],good,good.replace('13 thế giới','12 thế giới'),{'accuracyGood':'faithful','accuracyBad':'material_error'},True)
    else:
        # Exact genuine source excerpt with a numeric fact unrelated to the target spelling.
        c=next(c for c in controls if c['case']=='hooltampanas-canonical-name')
        good=c['packet']['A'];assert '5,764,801' in good
        add('new-number-error-outside-term','Hooltampanas',c['packet']['source'],good,good.replace('5,764,801','5,764,800'),{'accuracyGood':'faithful','accuracyBad':'material_error'},True)
    write(dest/'controls.json',items)
    write(dest/'freeze.json',{'inputSha256':hashlib.sha256((dest/'controls.json').read_bytes()).hexdigest(),'codeSha256':hashlib.sha256((HERE/'full_extra_calibration_dispatch.mjs').read_bytes()).hexdigest(),
        'rule':'Expected judgments remain outside model packets. Main benchmark inputs and judgments remain unchanged.'})
    return dest

def main():
    p=argparse.ArgumentParser();p.add_argument('--language',choices=['vi','en'],required=True);a=p.parse_args();dest=prepare(a.language)
    base=(HERE/'lab.mjs').read_text();base=base[:base.index("\ntry{\n if(command==='prepare')")]
    full=(HERE/'full_research_dispatch.mjs').read_text();full=full[:full.index('\ntry{\n if(phase===')]
    module=HERE/f'.full-extra-calibration-{os.getpid()}.mjs';module.write_text(base+'\n'+full+'\n'+(HERE/'full_extra_calibration_dispatch.mjs').read_text())
    try:
        subprocess.check_call(['node','--check',str(module)])
        subprocess.check_call(['node',str(module),'extra-calibration','--run',str(ROOT/a.language),'--language',a.language,'--workers','1'])
    finally:module.unlink(missing_ok=True)

if __name__=='__main__':main()
