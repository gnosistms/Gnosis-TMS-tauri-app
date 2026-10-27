"""Reuse the tested narrow numeric-unit identity proof; no inference and no broad fuzzy merge."""
from htn_prepare import RUN
from efficient_design import read,write
from deterministic_names import discover
input=read(RUN/'terms/04/input.json');source=input['originals'][0];pair=source['pair']
payload={'term':'Hooltampanas','nearSourceSpellings':read(RUN/'terms/04/near-source-identity.json'),'originalPassages':{'author':pair['original_author'],'book_id':pair['book_id'],'title_es':pair['title'],'language':'en','items':source['passages']},'nearSourcePassages':{'items':source['spanishEdition']},'passages':input['research']}
proof=discover(payload)
write(RUN/'terms/04/alias-proof.json',{'rule':'Existing tested unique one-edit counterpart + same large numeric/unit fingerprint + name directly attested in original edition','proof':proof,'researchModelCalls':0,'inputPacket':'input.json originals/research','limitation':'This narrow rule cannot resolve Hasnamuss spelling families or ordinary fuzzy look-alikes.'})
print(proof['observed'],proof['canonical'],proof['value'],proof['unit'])
