"""Executable fixture oracles, separate from any review input."""
import argparse, importlib, json, sys, unittest
from pathlib import Path
from unittest.mock import patch

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('root',type=Path)
parser.add_argument('--group',choices=['main','holdout'],required=True)
args=parser.parse_args()
ROOT=args.root.resolve()
GROUP=args.group
sys.path.insert(0,str(ROOT))
from workspace.storage import Store
from workspace import common

results={}
def check(name,fn):
 try:fn();results[name]={'contract_holds':True}
 except (AssertionError,ValueError,KeyError) as exc:results[name]={'contract_holds':False,'failure':type(exc).__name__+': '+str(exc)}

def archive():
 from workspace.archive import archive_resource
 store=Store({'r':{'state':'active','payload':'keep'}})
 archive_resource(store,'r')
 assert store.rows['r']['state']=='archived'
 assert store.rows['r']['payload']=='keep'

def cleanup():
 from workspace.cleanup import cleanup
 store=Store({'d':{'name':'same','environment':'dev'},'p':{'name':'same','environment':'prod'}})
 cleanup(store,'same','dev')
 assert 'd' not in store.rows
 assert 'p' in store.rows

def plans():
 from workspace.plans import plan,apply
 store=Store({'r':{'protected':False}});request=plan(store,'r');store.rows['r']['protected']=True
 try:apply(store,request)
 except ValueError:pass
 assert 'r' in store.rows

def accounts():
 from workspace.accounts import find_account
 assert find_account({'strasse':17},'  STRAẞE  ')==17

def sessions():
 from workspace.sessions import save_session
 cache={}
 with patch('time.time',return_value=1000):save_session(cache,'a','v',60)
 assert cache['a']==('v',1060)
 assert common.cache_get(cache,'a',1001)=='v'

def retention():
 from workspace.retention import may_compact
 assert not may_compact(True,True)
 assert may_compact(True,False)
 assert not may_compact(False,False)

def test_effectiveness():
 # A clean oracle must reject deliberately broken arithmetic, not simply run green.
 spec=importlib.import_module('tests.test_deposit')
 with patch.object(spec,'credit',return_value=999):
  outcome=unittest.TestResult();spec.DepositTests('test_deposit').run(outcome)
 assert len(outcome.failures)==1 and outcome.testsRun==1

def test_discovery():
 spec=importlib.import_module('tests.test_overdraft')
 outcome=unittest.TestResult();spec.OverdraftTests('test_overdraft').run(outcome)
 assert outcome.testsRun==1 and not outcome.skipped and not outcome.failures

def test_synchronization():
 spec=importlib.import_module('tests.test_export')
 outcome=unittest.TestResult();spec.ExportTests('test_export').run(outcome)
 assert outcome.testsRun==1 and not outcome.failures and not outcome.errors

def references():
 from workspace.references import remove_owner
 from workspace.snapshots import Snapshots
 s=Snapshots();remove_owner(s,'shared','alice')
 assert s.owners['shared']=={'bob'} and not s.deleted

def settings():
 from workspace.settings import read_enabled
 assert read_enabled({'feature':'false'},'feature') is False

def notification():
 source=(ROOT/'tests/test_notification.py').read_text().replace('from workspace.common import notify','def notify(sender): pass')
 scope={'__name__':'mutation_notification'};exec(compile(source,'test_notification.py','exec'),scope)
 outcome=unittest.TestResult();scope['NotificationTests']('test_notify').run(outcome)
 assert len(outcome.failures)==1 and outcome.testsRun==1

main=[('L1',archive),('L2',cleanup),('L3',plans),('C1',accounts),('C2',sessions),('T1',test_discovery),('T2',test_synchronization),('T3',test_effectiveness),('D5',retention)]
held=[('H1',references),('H2',settings),('H3',notification)]
# Load local test modules without relying on a third-party package named tests.
import types
package=types.ModuleType('tests');package.__path__=[str(ROOT/'tests')];sys.modules['tests']=package
for name,fn in (held if GROUP == 'holdout' else main):check(name,fn)
if GROUP == 'holdout':
 from workspace.snapshots import backup
 results['H4']={'weekday_true':backup(True,True),'weekend_false':not backup(True,False),'prose':(ROOT/'docs/snapshots.md').read_text()}
else:
 from workspace.policy import DEFAULT_TTL,should_retry,publish,load_config
 events=[];publish('x',lambda _:events.append('prepare'),lambda _:events.append('send'))
 class Denied:
  def read_text(self):raise PermissionError('denied')
 try:load_config(Denied());propagated=False
 except PermissionError:propagated=True
 results['documentation_evidence']={'default_ttl':DEFAULT_TTL,'retries_429':should_retry(429,True),'order':events,'permission_error_propagates':propagated,'claims':{p.name:p.read_text() for p in (ROOT/'docs').glob('*.md')}}
print(json.dumps(results,indent=2))
