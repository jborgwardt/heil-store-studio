import base64,json,pathlib,urllib.request,socket
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer

def rpc(method):
    cookie=pathlib.Path('/chain/.cookie').read_text().strip()
    request=urllib.request.Request('http://node:9332',data=json.dumps({'jsonrpc':'1.0','id':'dashboard','method':method,'params':[]}).encode(),headers={'Authorization':'Basic '+base64.b64encode(cookie.encode()).decode(),'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=10) as response:
        data=json.load(response)
    if data.get('error'): raise RuntimeError('Node starting')
    return data['result']

PAGE="""<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Litecoin Node</title><style>body{background:#101827;color:#eef2ff;font:18px system-ui;margin:0}main{max-width:800px;margin:8vh auto;padding:28px}header{display:flex;align-items:center;gap:20px}img{width:80px}p,small{color:#aab8d0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px}article{background:#1c2941;border-radius:16px;padding:24px}strong{display:block;font-size:30px;margin-top:8px}progress{width:100%;height:24px;accent-color:#87adff}</style></head><body><main><header><img src="/icon.png" alt="Litecoin"><div><h1>Litecoin Node</h1><p>Heil · Litecoin Core</p></div></header><h2 id="state">Connecting to node...</h2><progress id="progress" max="1" value="0"></progress><p id="status">Waiting for startup.</p><div class="grid"><article>Validated blocks<strong id="blocks">—</strong></article><article>Known headers<strong id="headers">—</strong></article><article>Peers<strong id="peers">—</strong></article><article>Chain storage<strong id="disk">—</strong></article></div><p>Full node · Mainnet · Wallet disabled</p><small id="updated"></small></main><script>async function update(){try{let r=await fetch('/api/status',{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error();document.getElementById('state').textContent=d.initialblockdownload?'Synchronizing blockchain':'Node is synchronized';document.getElementById('progress').value=d.verificationprogress;document.getElementById('status').textContent=(d.verificationprogress*100).toFixed(2)+'% verified';for(let k of ['blocks','headers','peers'])document.getElementById(k).textContent=d[k].toLocaleString();document.getElementById('disk').textContent=(d.size_on_disk/1073741824).toFixed(2)+' GiB';document.getElementById('updated').textContent='Updated '+new Date().toLocaleTimeString()}catch(e){document.getElementById('state').textContent='Node starting or unavailable';document.getElementById('status').textContent='Retrying automatically. Initial startup can take a few minutes.'}}update();setInterval(update,15000);</script></body></html>""".encode()

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path=self.path.split('?')[0];code=200
        if path=='/api/status':
            mime='application/json'
            try:
                d=rpc('getblockchaininfo');d['peers']=rpc('getconnectioncount')
                body=json.dumps({k:d[k] for k in ['blocks','headers','verificationprogress','initialblockdownload','size_on_disk','peers']}).encode()
            except Exception:
                code=503;body=b'{"error":"Node is starting or unavailable"}'
        elif path=='/':mime='text/html; charset=utf-8';body=PAGE
        elif path=='/icon.png':mime='image/png';body=pathlib.Path('/app/icon.png').read_bytes()
        else:code=404;mime='text/plain';body=b'Not found'
        self.send_response(code);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
print('Litecoin dashboard listening on '+socket.gethostbyname(socket.gethostname())+':8080',flush=True)
ThreadingHTTPServer(('0.0.0.0',8080),Handler).serve_forever()
