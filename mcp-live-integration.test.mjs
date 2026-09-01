import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {Client} from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StreamableHTTPClientTransport} from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';

function listen(server){
  return new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>resolve(server.address().port));
  });
}

function waitForReady(child){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('mcp_start_timeout')),5000);
    const onData=chunk=>{
      if(String(chunk).includes('listening on')){
        clearTimeout(timer);
        child.stdout.off('data',onData);
        resolve();
      }
    };
    child.stdout.on('data',onData);
    child.once('exit',code=>{
      clearTimeout(timer);
      reject(new Error(`mcp_exited_${code}`));
    });
  });
}

test('real Streamable HTTP MCP lists six tools and calls chass_health',async t=>{
  const mockBridge=createServer((req,res)=>{
    assert.equal(req.method,'GET');
    assert.equal(req.url,'/api/chass/v1/health');
    assert.equal(req.headers.authorization,'Bearer bridge-secret');
    res.writeHead(200,{'content-type':'application/json; charset=utf-8'}).end(JSON.stringify({
      ok:true,
      bridgeVersion:'1.1',
      modelVersion:'9.9.32',
      schemaVersion:'1.1',
      database:true,
      generatedAt:'2026-08-31T12:00:00.000Z',
      capabilities:{race:true,research:true,pending:true,originalSnapshot:true,liveAdjusted:true}
    }));
  });
  const bridgePort=await listen(mockBridge);
  t.after(()=>mockBridge.close());

  const probe=createServer();
  const mcpPort=await listen(probe);
  await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['mcp/server.mjs'],{
    cwd:new URL('..',import.meta.url),
    env:{
      ...process.env,
      CHASS_API_BASE_URL:`http://127.0.0.1:${bridgePort}`,
      CHASS_BRIDGE_TOKEN:'bridge-secret',
      MCP_HOST:'127.0.0.1',
      MCP_PORT:String(mcpPort)
    },
    stdio:['ignore','pipe','pipe']
  });
  t.after(()=>child.kill('SIGTERM'));
  await waitForReady(child);

  const client=new Client({name:'chass-integration-test',version:'1.0.0'});
  const transport=new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`));
  await client.connect(transport);
  t.after(()=>transport.close());

  const listed=await client.listTools();
  assert.deepEqual(listed.tools.map(tool=>tool.name).sort(),[
    'chass_get_latest','chass_get_pending','chass_get_race','chass_get_recent','chass_get_research','chass_health'
  ]);
  assert.ok(listed.tools.every(tool=>tool.annotations?.readOnlyHint===true));

  const called=await client.callTool({name:'chass_health',arguments:{}});
  assert.equal(called.isError,false);
  assert.equal(called.structuredContent.ok,true);
  assert.equal(called.structuredContent.connectorVersion,'9.9.32');
  assert.equal(called.structuredContent.data.databaseAvailable,true);
  assert.equal(called.structuredContent.source,'CHASS KEIBA LAB D1');
});
