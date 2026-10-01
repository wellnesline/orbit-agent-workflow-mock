"""Serve only this requested demo and its read-only inspection assets (GET only, loopback)."""
import os
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
BASE=Path(__file__).resolve().parent
PORT=int(os.environ.get('MOCK_PORT','8090'))  # loopback port; override with MOCK_PORT
APP='/viewer/agent-workspace/'
PIPE='/viewer/agent-workspace-pipeline/'
FILES={APP:'index.html',PIPE:'pipeline.html'}
for name in ['index.html','app.mjs','model.mjs','style.css','seed.json']:FILES[APP+name]=name
for name in ['pipeline.mjs','snapshot.json','inspection.json']:FILES[PIPE+name]=name
TYPES={'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.json':'application/json'}
CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
def main():
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):self.send_error(405)
        def do_GET(self):
            path=self.path.split('?',1)[0]
            if path not in FILES:self.send_error(404);return
            file=BASE/'public'/FILES[path]
            if not file.is_file():self.send_error(404);return
            data=file.read_bytes()
            self.send_response(200);self.send_header('Content-Type',TYPES[file.suffix]+'; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Content-Security-Policy',CSP);self.end_headers();self.wfile.write(data)
    server=ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
    print(f'Serving fixed static assets on http://127.0.0.1:{PORT}/viewer/agent-workspace/',flush=True)
    server.serve_forever()
if __name__=='__main__':main()