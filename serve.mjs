import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('dist');
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.wasm':'application/wasm'};
http.createServer(async(req,res)=>{try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const p=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!p.startsWith(root+path.sep)) throw Error('Invalid path');
  res.setHeader('Content-Type',types[path.extname(p)]||'application/octet-stream');
  res.end(await readFile(p));
}catch{res.statusCode=404;res.end('Not found');}}).listen(4173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4173'));
