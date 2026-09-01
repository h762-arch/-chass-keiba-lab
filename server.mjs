import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {z} from 'zod';
import {createChassTools,TOOL_DEFINITIONS,CONNECTOR_VERSION} from './chass-tools.mjs';

const HERE=fileURLToPath(new URL('.',import.meta.url));
function loadEnv(){const original=new Set(Object.keys(process.env));for(const name of ['.env','.env.local']){const file=resolve(HERE,name);if(!existsSync(file))continue;for(const line of readFileSync(file,'utf8').split(/\r?\n/)){const match=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);if(!match||line.trim().startsWith('#')||original.has(match[1]))continue;let value=match[2];if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);process.env[match[1]]=value}}}
loadEnv();

const host=process.env.MCP_HOST||'127.0.0.1',port=Number(process.env.MCP_PORT||8787),path='/mcp',accessToken=String(process.env.MCP_ACCESS_TOKEN||''),allowedOrigin=String(process.env.MCP_ALLOWED_ORIGIN||'');
if(!process.env.CHASS_API_BASE_URL||!process.env.CHASS_BRIDGE_TOKEN)throw new Error('CHASS_API_BASE_URL and CHASS_BRIDGE_TOKEN are required.');
if(!['127.0.0.1','localhost','::1'].includes(host)&&!accessToken)throw new Error('MCP_ACCESS_TOKEN is required when MCP_HOST is not loopback.');

const tools=createChassTools();
const annotations={readOnlyHint:true,destructiveHint:false,openWorldHint:false};
const outputSchema={ok:z.boolean(),schemaVersion:z.string().optional(),connectorVersion:z.string().optional(),source:z.string().optional(),generatedAt:z.string().optional(),data:z.any().optional(),error:z.string().optional(),message:z.string().optional(),status:z.number().nullable().optional(),retryAfterSeconds:z.number().nullable().optional()};
const result=payload=>({structuredContent:payload,content:[{type:'text',text:payload.ok?'CHASS KEIBA LABの保存済みD1データを取得しました。':`${payload.error}: ${payload.message}`}],isError:!payload.ok});
function createMcpServer(){
 const server=new McpServer({name:'chass-keiba-lab',version:CONNECTOR_VERSION},{instructions:'Read-only CHASS KEIBA LAB research connector. Original Snapshot is the official research prediction. Live Adjusted is separate. Never imply that these tools update predictions, D1, or NAR.'});
 server.registerTool('chass_health',{...TOOL_DEFINITIONS.chass_health,inputSchema:{},outputSchema,annotations},async()=>result(await tools.health()));
 server.registerTool('chass_get_race',{...TOOL_DEFINITIONS.chass_get_race,inputSchema:{raceId:z.string().min(1).optional(),date:z.string().optional(),track:z.string().optional(),raceNo:z.number().int().min(1).max(12).optional(),detail:z.enum(['compact','full']).default('compact')},outputSchema,annotations},async args=>result(await tools.getRace(args)));
 server.registerTool('chass_get_latest',{...TOOL_DEFINITIONS.chass_get_latest,inputSchema:{track:z.string().optional(),limit:z.number().int().min(1).max(20).default(10),detail:z.enum(['compact','full']).default('compact')},outputSchema,annotations},async args=>result(await tools.getLatest(args)));
 server.registerTool('chass_get_pending',{...TOOL_DEFINITIONS.chass_get_pending,inputSchema:{limit:z.number().int().min(1).max(20).default(10)},outputSchema,annotations},async args=>result(await tools.getPending(args)));
 server.registerTool('chass_get_research',{...TOOL_DEFINITIONS.chass_get_research,inputSchema:{},outputSchema,annotations},async()=>result(await tools.getResearch()));
 server.registerTool('chass_get_recent',{...TOOL_DEFINITIONS.chass_get_recent,inputSchema:{limit:z.number().int().min(1).max(20).default(10),track:z.string().optional(),date:z.string().optional(),detail:z.enum(['compact','full']).default('compact')},outputSchema,annotations},async args=>result(await tools.getRecent(args)));
 return server;
}

function authorized(req){if(!accessToken)return true;const header=String(req.headers.authorization||'');return header.startsWith('Bearer ')&&header.slice(7)===accessToken}
function cors(req,res){const origin=String(req.headers.origin||'');if(origin&&allowedOrigin&&origin===allowedOrigin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Methods','POST, GET, DELETE, OPTIONS');res.setHeader('Access-Control-Allow-Headers','content-type, mcp-session-id, authorization');res.setHeader('Access-Control-Expose-Headers','Mcp-Session-Id');res.setHeader('Vary','Origin')}}
const httpServer=createServer(async(req,res)=>{
 const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);cors(req,res);
 if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(JSON.stringify({ok:true,name:'CHASS KEIBA LAB MCP',version:CONNECTOR_VERSION,path,readOnly:true}));return}
 if(req.method==='OPTIONS'&&url.pathname===path){res.writeHead(204).end();return}
 if(url.pathname!==path){res.writeHead(404).end('Not Found');return}
 if(!authorized(req)){res.writeHead(401,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(JSON.stringify({ok:false,error:'unauthorized',message:'MCP access token is invalid.'}));return}
 if(!new Set(['POST','GET','DELETE']).has(req.method||'')){res.writeHead(405).end('Method Not Allowed');return}
 const server=createMcpServer(),transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
 res.on('close',()=>{transport.close();server.close()});
 try{await server.connect(transport);await transport.handleRequest(req,res)}catch(error){console.error('CHASS MCP request failed',{name:error?.name||'Error',message:String(error?.message||'request_failed')});if(!res.headersSent)res.writeHead(500).end('Internal server error')}
});
httpServer.listen(port,host,()=>console.info(`CHASS KEIBA LAB MCP Ver.${CONNECTOR_VERSION} listening on http://${host}:${port}${path}`));

