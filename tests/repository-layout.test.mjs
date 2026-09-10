import test from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile} from 'node:fs/promises';

const required=[
  '../migrations/0006_jra_background_refresh.sql',
  '../mcp/server.mjs',
  '../mcp/chass-tools.mjs',
  '../mcp/bridge-client.mjs',
  '../mcp/package.json',
  '../mcp/package-lock.json',
  '../.gitignore'
];

test('formal repository layout contains migration, MCP and secret guards',async()=>{
  await Promise.all(required.map(file=>access(new URL(file,import.meta.url))));
});

test('uploaded 0006 migration remains additive and J5-specific',async()=>{
  const sql=await readFile(new URL('../migrations/0006_jra_background_refresh.sql',import.meta.url),'utf8');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS jra_meeting_calendar/i);
  assert.doesNotMatch(sql,/\b(?:DROP|DELETE|UPDATE|ALTER)\b/i);
});

test('MCP exposes exactly six read-only tools through the AI Data Bridge',async()=>{
  const [server,tools]=await Promise.all([readFile(new URL('../mcp/server.mjs',import.meta.url),'utf8'),readFile(new URL('../mcp/chass-tools.mjs',import.meta.url),'utf8')]);
  assert.equal((server.match(/server\.registerTool\('/g)||[]).length,6);
  assert.match(server,/readOnlyHint:true/);
  assert.doesNotMatch(`${server}\n${tools}`,/keiba\.go\.jp|jra\.go\.jp/);
});


test('Root and MCP identities stay separated',async()=>{
  const [rootPackageText,mcpPackageText,rootServer,mcpServer,rootReadme,mcpReadme]=await Promise.all([
    readFile(new URL('../package.json',import.meta.url),'utf8'),
    readFile(new URL('../mcp/package.json',import.meta.url),'utf8'),
    readFile(new URL('../server.mjs',import.meta.url),'utf8'),
    readFile(new URL('../mcp/server.mjs',import.meta.url),'utf8'),
    readFile(new URL('../README.md',import.meta.url),'utf8'),
    readFile(new URL('../mcp/README.md',import.meta.url),'utf8')
  ]);
  const rootPackage=JSON.parse(rootPackageText),mcpPackage=JSON.parse(mcpPackageText);
  assert.equal(rootPackage.name,'chass-keiba-lab');
  assert.equal(rootPackage.version,'10.0.1');
  assert.equal(mcpPackage.name,'chass-keiba-lab-mcp');
  assert.doesNotMatch(rootServer,/@modelcontextprotocol\/sdk\/server|new\s+McpServer/);
  assert.match(mcpServer,/McpServer/);
  assert.match(mcpServer,/StreamableHTTPServerTransport/);
  assert.match(rootReadme,/^# CHASS KEIBA LAB Ver\.10\.0\.1/m);
  assert.match(mcpReadme,/^# CHASS KEIBA LAB MCP/m);
});

test('formal layout rejects flattened MCP, migration and test duplicates',async()=>{
  const forbidden=[
    '../0006_jra_background_refresh.sql',
    '../bridge-client.mjs',
    '../chass-tools.mjs',
    '../jra-j1.test.mjs',
    '../jra-j5.test.mjs',
    '../repository-layout.test.mjs'
  ];
  for(const file of forbidden)await assert.rejects(access(new URL(file,import.meta.url)));
});
