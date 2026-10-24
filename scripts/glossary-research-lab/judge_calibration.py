"""Blind positive/negative controls for the actual frozen judge pipeline.

These artificial controls check basic sensitivity, false wins and side effects;
they are not a human gold standard for subtle real ES-VI corpus distinctions.
"""
import argparse, hashlib, json
from pathlib import Path

parser=argparse.ArgumentParser();parser.add_argument('--run',type=Path,required=True)
args=parser.parse_args();run=args.run.resolve();run.mkdir(parents=True,exist_ok=True)
seed=415271;method='curated-proposal';reference='calibration-reference'
controls=[
 ('error','Juan no compró el libro.','Juan không mua cuốn sách.','Juan đã mua cuốn sách.'),
 ('error','Juan nació en 1952.','Juan sinh năm 1952.','Juan sinh năm 1852.'),
 ('error','Llegaron tres personas.','Có ba người đến.','Có bốn người đến.'),
 ('error','Juan llegó a Lima, no a Quito.','Juan đến Lima, không phải Quito.','Juan đến Quito, không phải Lima.'),
 ('error','El Íntimo no es el yo psicológico.','Đấng Nội Tại không phải là bản ngã tâm lý.','Đấng Nội Tại chính là bản ngã tâm lý.'),
 ('error','Aquí «fatal» significa inevitable, no mortal.','Ở đây, «fatal» có nghĩa là tất yếu, không phải chết người.','Ở đây, «fatal» có nghĩa là chết người, không phải tất yếu.'),
 ('error','Por vanidad se preocupa demasiado por su apariencia; aquí no hablamos de la inutilidad de sus actos.','Vì tính phù hoa, người ấy quá bận tâm đến vẻ ngoài; ở đây chúng ta không nói về sự vô ích của những hành động của người ấy.','Vì hành động của mình vô ích, người ấy quá bận tâm đến vẻ ngoài; ở đây chúng ta không nói về sự vô ích của những hành động của người ấy.'),
 ('error','Estos mundos son planetas físicos, no estados espirituales.','Những thế giới này là các hành tinh vật chất, không phải những trạng thái tâm linh.','Những thế giới này là các trạng thái tâm linh, không phải các hành tinh vật chất.'),
 ('acceptable','El libro está sobre la mesa.','Cuốn sách nằm trên bàn.','Quyển sách ở trên bàn.'),
 ('acceptable','Juan vive en esta casa.','Juan sống trong căn nhà này.','Juan sống ở ngôi nhà này.'),
 ('acceptable','El vaso está vacío.','Cái cốc trống không.','Cái ly không có gì bên trong.'),
 ('acceptable','Ella abrió la puerta.','Cô ấy mở cửa.','Cô ấy mở cánh cửa.'),
 ('acceptable','No sabemos cuándo llegará Juan.','Chúng tôi không biết khi nào Juan sẽ đến.','Chúng tôi không biết Juan sẽ đến lúc nào.'),
 ('acceptable','El niño estaba muy contento.','Cậu bé rất vui.','Đứa bé rất vui vẻ.'),
 ('acceptable','Juan empezó a estudiar.','Juan bắt đầu học.','Juan bắt đầu việc học.'),
 ('acceptable','Nos encontramos después de la reunión.','Chúng tôi gặp nhau sau cuộc họp.','Sau cuộc họp, chúng tôi gặp nhau.'),
 ('identical-good','Juan compró dos libros.','Juan mua hai cuốn sách.','Juan mua hai cuốn sách.'),
 ('identical-good','La puerta está cerrada.','Cửa đang đóng.','Cửa đang đóng.'),
 ('identical-bad','Juan no compró el libro.','Juan đã mua cuốn sách.','Juan đã mua cuốn sách.'),
 ('identical-bad','Juan nació en 1952.','Juan sinh năm 1852.','Juan sinh năm 1852.'),
]
side=lambda key:'A'if int(hashlib.sha256(f'{seed}:1:{method}:{reference}:{key}'.encode()).hexdigest()[:8],16)%2==1 else'B'
evaluation=[];candidate=[];baseline=[];gold=[]
for i,(kind,source,good,other)in enumerate(controls,1):
    first=f'c{i:02}-0';second=next(f'c{i:02}-{n}'for n in range(1,100)if side(f'c{i:02}-{n}')!=side(first))
    for key in (first,second):
        evaluation.append({'itemId':key,'text':source})
        candidate.append({'id':key,'translation':good});baseline.append({'id':key,'translation':other})
        gold.append({'id':key,'control':kind,'candidateSide':side(key),'expectedAccuracy':side(key)if kind=='error'else'tie'})
write=lambda p,v:(p.parent.mkdir(parents=True,exist_ok=True),p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n'))
if not(run/'manifest.json').exists():
    write(run/'manifest.json',{'seed':seed,'population':None,'terms':[{'entry_id':'synthetic-control','source_terms':['synthetic judge calibration']}],
                             'notAGlossarySample':True,'purpose':'Basic judge calibration; manually constructed source-faithful vs defective, acceptable alternatives and identical pairs.'})
    d=run/'terms/01';write(d/'evidence.json',{'term':'synthetic judge calibration','population':{'distinct':len(controls)},'evaluation':evaluation,'research':[],'forms':[],'overlap':0})
    for name,translations in [(method,candidate),(reference,baseline)]:
        write(d/name/'entry.json',{'entries':[],'status':'done','syntheticJudgeControl':True})
        write(d/name/'controlled/translations.json',translations)
    write(run/'control-gold.json',gold)
result=run/f'terms/01/{method}/controlled/vs-{reference}/strict/judgments.json'
if result.exists():
    rows=json.loads(result.read_text());mapping={g['id']:g for g in gold}
    if len(rows)!=len(gold)or{r['id']for r in rows}!=set(mapping):raise ValueError('Incomplete calibration judgments')
    correct=[r for r in rows if r['accuracy']==mapping[r['id']]['expectedAccuracy']]
    report={'judgeModel':None,'cases':len(controls),'mirrorPresentations':len(rows),'correctPresentations':len(correct),
            'clearErrorsDetected':sum(r['accuracy']==mapping[r['id']]['expectedAccuracy']for r in rows if mapping[r['id']]['control']=='error'),
            'clearErrorPresentations':16,'falsePreferencesOnTies':sum(r['accuracy']!='tie'for r in rows if mapping[r['id']]['control']!='error'),
            'notHumanValidation':True,'limits':'Constructed simple controls cannot validate subtle terminology, shared domain assumptions or real-corpus tie sensitivity.',
            'failures':[{'id':r['id'],'expected':mapping[r['id']]['expectedAccuracy'],'observed':r['accuracy'],'reason':r['reason']}for r in rows if r not in correct]}
    write(run/'analysis-calibration.json',report);print(json.dumps(report,ensure_ascii=False))
else:print(json.dumps({'prepared':str(run),'cases':len(controls),'presentations':len(gold)}))
