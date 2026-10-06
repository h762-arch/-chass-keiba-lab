import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
test('historical research preserves original prediction timestamps',()=>{
 const start=app.indexOf('function historicalRecord');
 const end=app.indexOf('\nasync function persistHistoricalRecord',start);
 assert.ok(start>=0&&end>start);
 const body=app.slice(start,end);
 assert.match(body,/const originalPredictionSnapshot=state\.predictionSnapshot\?structuredClone\(state\.predictionSnapshot\):null/);
 assert.match(body,/originalPredictionSnapshot\?\.generatedAt\|\|originalPredictionSnapshot\?\.createdAt/);
 assert.match(body,/originalMarketSnapshot=state\.marketSnapshot\?structuredClone\(state\.marketSnapshot\):null/);
 assert.match(body,/originalMarketCreatedAt=originalMarketSnapshot\?\.createdAt\|\|originalMarketSnapshot\?\.acquiredAt/);
 assert.doesNotMatch(body,/state\.predictionSnapshot\.generatedAt=now;state\.predictionSnapshot\.createdAt=now/);
});
