import http from 'node:http';
import { execute, prove } from './engine.mjs';
http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  if(req.method==='GET'&&req.url==='/health'){res.end('{"ok":true}');return;}
  if(req.method!=='POST'||!['/execute','/prove'].includes(req.url)){res.writeHead(404).end('{}');return;}
  try{
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>512000)throw new Error('Request too large.');chunks.push(chunk);}
    const input=JSON.parse(Buffer.concat(chunks));
    res.end(JSON.stringify(req.url==='/prove'?prove(input):execute(input)));
  }catch(error){res.end(JSON.stringify({ok:false,message:error.public?error.message:'Invalid test pipeline request.',conflict:!!error.conflict}));}
}).listen(8090,'0.0.0.0');
