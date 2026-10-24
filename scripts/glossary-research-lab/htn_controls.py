"""Preregistered genuine-source evaluator controls: errors and valid alternatives."""
import json,re
from pathlib import Path
from efficient_design import read,write
from htn_prepare import RUN
controls=[]
def passage(index,pattern):
 d=read(RUN/'terms'/f'{index:02}'/'input.json')
 for p in d['test']+d['research']:
  if re.search(pattern,p['text'],re.I):return p
 raise ValueError(pattern)
def add(case,index,pattern,language,A,B,expected):
 p=passage(index,pattern);req=read(RUN/'requirements.json')[read(RUN/'terms'/f'{index:02}'/'input.json')['term']]
 packet={'id':case+'-'+language,'source':p['text'],'term':read(RUN/'terms'/f'{index:02}'/'input.json')['term'],'language':language,'criteria':req,'A':A,'B':B,'renderingsOnly':True,'sourceId':p['itemId']}
 controls.append({'case':case,'packet':packet,'expected':expected})
 inverse={k[:-1]+('B' if k[-1]=='A' else 'A'):v for k,v in expected.items()}
 controls.append({'case':case,'packet':{**packet,'id':packet['id']+'-mirror','A':B,'B':A},'expected':inverse})
for l,planet,world,realm in [('en','planet','world','realm of the mind'),('vi','hành tinh','thế giới','cõi tâm trí')]:
 add('planet-underselection',1,'mundo Tierra',l,world,planet,{'policyA':'fail','policyB':'pass'})
 add('planet-overapplication',1,'mundo de la mente',l,planet,realm,{'accuracyA':'material_error','accuracyB':'faithful'})
for l,correct,wrong in [('en','perceptible images','sensible images'),('vi','những hình ảnh có thể cảm nhận bằng giác quan','những hình ảnh hợp lý')]:
 add('sensible-false-friend',2,'imágenes sensibles',l,wrong,correct,({'policyA':'fail','policyB':'pass'} if l=='en' else {'accuracyA':'material_error','accuracyB':'faithful','policyA':'fail','policyB':'pass'}))
add('sensible-explicit-wrong-sense',2,'imágenes sensibles','en','reasonable images','perceptible images',{'accuracyA':'material_error','accuracyB':'faithful','policyA':'fail','policyB':'pass'})
add('feeling-center-is-not-sensory-default',2,'centro sensible','en','feeling center','emotional center',{'accuracyA':'faithful','accuracyB':'faithful','policyA':'pass','policyB':'pass'})
add('vanidad-human-criterion',3,'vanidad preferiría','vi','phù phiếm','sự chăm chút hình ảnh của mình trong mắt người khác',{'policyA':'fail','policyB':'pass'})
add('vanidad-valid-alternatives',3,'vanidad preferiría','vi','sự chăm chút hình ảnh của mình trong mắt người khác','sự chú trọng hình ảnh bản thân trước người khác',{'accuracyA':'faithful','accuracyB':'faithful','policyA':'pass','policyB':'pass'})
add('hool-canonical-spelling',4,'Hooltampanas','en','Hooltampanas','Hooltanpanas',{'policyA':'fail','policyB':'pass'})
add('hool-name-definition',4,'Hooltampanas','en','a cosmic color range','Hooltanpanas',{'policyA':'fail','policyB':'pass'})
add('hasnamuss-singular',5,'un Hanasmussen','en','a Hanasmussen','a Hasnamuss',{'policyA':'fail','policyB':'pass'})
add('hasnamussen-plural',5,'los HANASMUSSEN','en','the Hasnamuss','the Hasnamussen',{'policyA':'fail','policyB':'pass'})
for l,wrong,correct in [('en','a deadly technique','a harmful technique'),('vi','một kỹ thuật gây chết người','một kỹ thuật tai hại')]:
 add('fatal-harm-is-not-death',6,'técnica fatal',l,wrong,correct,{'accuracyA':'material_error','accuracyB':'faithful','policyA':'fail','policyB':'pass'})
add('fatal-acceptable-alternatives',6,'técnica fatal','en','a harmful technique','a pernicious technique',{'accuracyA':'faithful','accuracyB':'faithful','policyA':'pass','policyB':'pass'})
for l,correct,wrong in [('en','a close friend','an Innermost friend'),('vi','một người bạn thân','một người bạn Đấng Nội Tại')]:
 add('intimo-ordinary-adjective',7,'amigo íntimo',l,wrong,correct,{'accuracyA':'material_error','accuracyB':'faithful'})
for l,correct,wrong in [('en','the Innermost','the inner self'),('vi','Đấng Nội Tại','Chân ngã')]:
 add('intimo-required-name',7,'vive el ÍNTIMO',l,wrong,correct,{'policyA':'fail','policyB':'pass'})
# Identical bad renderings must be scored defective on both sides, without a winner.
add('identical-bad-controls',2,'imágenes sensibles','en','sensible images','sensible images',{'policyA':'fail','policyB':'fail'})
write(RUN/'assessment-only/controls.json',controls)
write(RUN/'provenance-supplement.json',{'hasnamuss':{'book':"G. I. Gurdjieff, Beelzebubs Erzählungen für seinen Enkel, Erstes Buch (German edition)",'url':'https://www.imagomundi.biz/wp-content/uploads/2025/10/PSL132.1-Belzebubs_Erzaehlungen_fuer_seine_Enkel_I-G_I_Gurdjieff.pdf','page':'PDF 225 / printed 432','quote':'Bei den Hasnamussen der ersten Art','claim':'German edition attests Hasnamussen as plural. The cached English witness uses Hasnamusses instead; human English project requirement prescribes Hasnamussen. Do not misstate which edition supports which form.','singularWitness':'Cached English original passages directly attest Hasnamuss.'}})
print(len(controls),'mirrored evaluator presentations, seven terms covered')
