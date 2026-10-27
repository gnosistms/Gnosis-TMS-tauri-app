"""Post-confirmation diagnostic; never substitutes for the frozen v4 benchmark."""
import os,subprocess
from htn_runner import HERE,RUN
base=(HERE/'lab.mjs').read_text();base=base[:base.index("\ntry{\n if(command==='prepare')")]
dispatch=(HERE/'htn_dispatch.mjs').read_text();dispatch=dispatch[:dispatch.rindex('\ntry{\n const auth=')]
m=HERE/f'.htn-selection-{os.getpid()}.mjs';m.write_text(base+'\n'+dispatch+'\n'+(HERE/'htn_selection_diagnostic_dispatch.mjs').read_text())
try:
 subprocess.check_call(['node','--check',str(m)])
 subprocess.check_call(['node',str(m),'diagnostic','--run',str(RUN),'--method','selection-diagnostic','--workers','1','--source-context','neighbors'])
finally:m.unlink(missing_ok=True)
