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
