"""Register a dedicated no-LLM demo preparation pipeline. Run in WSL; no secrets in output."""
import base64, copy, hashlib, json, os, sys, time, uuid, zlib
from pathlib import Path
BASE=Path(__file__).resolve().parent
sys.path.insert(0,str(BASE.parent/'visual_workflow'))
from bootstrap import Client, save
from templates import dify_workflow,n8n_workflow
from viewer import normalize

def main():
    runtime=Path(os.environ['POC_DIR'])  # runtime directory inside WSL (see the viewer repository's deploy.py)
    secret=json.loads((runtime/'secrets.json').read_text())
    shared=json.loads((runtime/'bootstrap-state.json').read_text())
    statefile=runtime/'personal-agent-mock-state.json'
    state=json.loads(statefile.read_text()) if statefile.exists() else {}
    out=BASE/'evidence'; out.mkdir(exist_ok=True)
    public=BASE/'public'; public.mkdir(exist_ok=True)
    fixture=json.loads((BASE/'fixture.json').read_text())
    dsl=dify_workflow()
    dsl['app']['name']='ORBIT | 操作モックのデータ準備'
    dsl['app']['description']='固定の架空データを生成するCodeノード。LLM呼び出しなし。'
    code="import json, zlib, base64\ndef main(title: str) -> dict:\n    if not title.strip():\n        raise ValueError('title required')\n    seed = json.loads("+repr(json.dumps(fixture,ensure_ascii=False))+ ")\n    return {'title': title, 'outline': 'zlib64:' + base64.b64encode(zlib.compress(json.dumps(seed, ensure_ascii=False).encode('utf-8'))).decode('ascii'), 'project': 'project-a', 'mock': True}\n"
    dsl['workflow']['graph']['nodes'][1]['data'].update(code=code,title='操作モックの架空データを準備')
    dify=Client('http://localhost:8080/console/api'); n8n=Client('http://localhost:5678/rest')
    dify.call('POST','/login',{'email':secret['owner_email'],'password':base64.b64encode(secret['owner_password'].encode()).decode()})
    n8n.call('POST','/login',{'emailOrLdapLoginId':secret['owner_email'],'password':secret['owner_password']})
    if 'app_id' not in state:
        r=dify.call('POST','/apps/imports',{'mode':'yaml-content','yaml_content':json.dumps(dsl,ensure_ascii=False)})
        if r.get('status') not in ('completed','completed-with-warnings'): raise RuntimeError('Dify import incomplete')
        state['app_id']=r['app_id'];save(statefile,state)
    app=state['app_id']
    # Save draft from the current source on every run, preserving this dedicated app only.
    draft=dify.call('GET',f'/apps/{app}/workflows/draft')
    dify.call('POST',f'/apps/{app}/workflows/draft',{'graph':dsl['workflow']['graph'],'features':dsl['workflow']['features'],'hash':draft['hash']})
    dify.call('POST',f'/apps/{app}/workflows/publish',{'marked_name':'ORBIT mock','marked_comment':'Code only; no LLM'})
    keys=dify.call('GET',f'/apps/{app}/api-keys').get('data',[])
    key=keys[0]['token'] if keys else dify.call('POST',f'/apps/{app}/api-keys')['token']
    if 'credential_id' not in state:
        state['credential_id']=n8n.call('POST','/credentials',{'name':'ORBIT Dify mock','type':'httpHeaderAuth','data':{'name':'Authorization','value':'Bearer '+key}})['data']['id'];save(statefile,state)
    w=n8n_workflow('project-a',state['credential_id'],shared['credentials']['adapter'],shared['credentials']['webhook'])
    w['name']='ORBIT | Difyでモック準備 → 模擬jobを観測'
    w['nodes'][0]['parameters']['path']='personal-agent-mock'
    if 'workflow_id' not in state:
        state['workflow_id']=n8n.call('POST','/workflows',w)['data']['id'];save(statefile,state)
    wid=state['workflow_id']; existing=n8n.call('GET','/workflows/'+wid)['data']
    if existing.get('active'): n8n.call('POST',f'/workflows/{wid}/deactivate',{})
    existing=n8n.call('PATCH','/workflows/'+wid,{k:w[k] for k in ('name','nodes','connections','settings')})['data']
    n8n.call('POST',f'/workflows/{wid}/activate',{'versionId':existing['versionId']})
    time.sleep(2)
    idem='orbit-'+str(uuid.uuid4()); api=Client('http://localhost:5678')
    body={'title':'ORBIT 操作モック','idempotency_key':idem};headers={'X-PoC-Key':secret['webhook_token']}
    result=api.call('POST','/webhook/personal-agent-mock',body,headers)
    repeat=api.call('POST','/webhook/personal-agent-mock',body,headers)
    if result.get('status')!='completed' or result['job_id']!=repeat['job_id']:raise RuntimeError('Mock E2E failed')
    outline=result['result']['outline']
    if not outline.startswith('zlib64:'):raise RuntimeError('Unexpected seed encoding')
    seed=json.loads(zlib.decompress(base64.b64decode(outline[7:])))
    if seed!=fixture:raise RuntimeError('Produced seed differs from fixture')
    actual=n8n.call('GET','/workflows/'+wid)['data']
    exported={k:actual[k] for k in ('name','nodes','connections','settings')}
    for node in exported['nodes']:
        for item in node.get('credentials',{}).values():item['id']='LOCAL_CREDENTIAL'
    published=dify.call('GET',f'/apps/{app}/workflows/publish')
    dsl['workflow']['graph']=published['graph']
    def write(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
    write(out/'n8n.json',exported);write(out/'dify.json',dsl)
    snap=normalize(exported,dsl,'project-a','agent-workspace-pipeline','ORBIT · モックデータの準備工程')
    write(public/'snapshot.json',snap);write(public/'seed.json',seed)
    write(out/'runtime.json',{'status':'passed','actual_services':True,'model_calls':0,'mock':True,'job_id':result['job_id'],'job_status':result['status'],'idempotent':True,'workflow_id':wid,'app_id':app,'dify_run_status':'succeeded','seed_sha256':hashlib.sha256((public/'seed.json').read_bytes()).hexdigest(),'verified_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})
    print(json.dumps({'status':'passed','mock':True,'model_calls':0,'job_id':result['job_id'],'idempotent':True}))

if __name__=='__main__':main()

