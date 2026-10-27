const numberInput=inp(4),numberSource=numberInput.test.find(p=>p.text.includes('5.764.801')||p.text.includes('5,764,801'));
if(!numberSource)throw Error('Genuine numeric unit passage missing');
const correctNumber='(One Hooltanpanas is equivalent to 5,764,801 shades of the universal cosmic color.)',wrongNumber=correctNumber.replace('5,764,801','5,764,800');
const numberPackets=[{id:'number-a',source:numberSource.text,term:numberInput.term,language:'en',criteria:requirements[numberInput.term],A:wrongNumber,B:correctNumber},{id:'number-b',source:numberSource.text,term:numberInput.term,language:'en',criteria:requirements[numberInput.term],A:correctNumber,B:wrongNumber}];
const numberRows=await grade(4,'whole-number-fault-control',numberPackets);const failures=numberRows.filter(r=>r.wholePassageA!==(r.id==='number-a'?'material_error':'faithful')||r.wholePassageB!==(r.id==='number-a'?'faithful':'material_error'));
write(`${run}/number-fault-control.json`,{presentations:2,passed:!failures.length,failures,rows:numberRows,sourceId:numberSource.itemId});
