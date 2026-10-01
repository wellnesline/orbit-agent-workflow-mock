"""Verify anonymous fixed-file delivery; --record updates HTTP receipts only."""
import hashlib,json,os,sys,re
from pathlib import Path
from urllib.request import urlopen,Request
from urllib.error import HTTPError
from datetime import datetime,timezone
BASE=Path(__file__).resolve().parent
ROOT="https://viewer.example.com/viewer/"  # example origin; set your own
APP=ROOT+"agent-workspace/"
PIPE=ROOT+"agent-workspace-pipeline/"
# Host of an analytics script that a CDN/proxy may inject into HTML responses (stripped before comparing bytes). Empty = none.
INJECTED_HOST=os.environ.get("INJECTED_SCRIPT_HOST","")
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def get(url,method="GET"):
    try:
        with urlopen(Request(url,method=method,headers={"User-Agent":"Mozilla/5.0"}),timeout=25) as r:return r.status,r.read()
    except HTTPError as e:return e.code,b""
def verify(record=False):
    paths={APP:"index.html",PIPE:"pipeline.html"}
    paths.update({APP+x:x for x in ["app.mjs","model.mjs","style.css","seed.json"]})
    paths.update({PIPE+x:x for x in ["pipeline.mjs","snapshot.json","inspection.json"]})
    for url,name in paths.items():
        status,body=get(url)
        if name.endswith(".html"):
            body=re.sub(rb'<script[^>]+src="https://'+re.escape(INJECTED_HOST.encode())+rb'/[^"\n]+"[^>]*></script>\n?',b"",body) if INJECTED_HOST else body
        assert status==200 and body==(BASE/"public"/name).read_bytes(), "Public bytes mismatch: "+name
    for url in [APP+"manifest.json",APP+"../../secrets.json",PIPE+"evidence/dify.json"]:
        assert get(url)[0]==404,"Unexpected exposed path"
    assert get(APP,"POST")[0]==405 and get(PIPE,"POST")[0]==405,"POST must be unavailable"
    stamp=datetime.now(timezone.utc).isoformat()
    if record:
        receipt={"status":"passed","url":PIPE,"read_only":True,"authentication":"none","http_status":200,"snapshot_sha256":sha(BASE/"public/snapshot.json"),"n8n_export_sha256":sha(BASE/"evidence/n8n.json"),"dify_export_sha256":sha(BASE/"evidence/dify.json"),"verified_at":stamp,"app_url":APP,"static_resources_verified":len(paths),"forbidden_paths_status":404,"post_status":405}
        (BASE/"evidence/public-view.json").write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"status":"passed","anonymous_resources":len(paths),"forbidden_paths_status":404,"post_status":405}))
if __name__=="__main__":verify("--record" in sys.argv)
