import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('v3.5.1 hidden dynamic viewer blocks collapse completely', () => {
  const css = fs.readFileSync(
    new URL('../viewer/viewer.css', import.meta.url),
    'utf8',
  );

  assert.match(css, /CHASS Viewer v3\.5\.1: hard hidden-state guard/);
  assert.match(css, /\.viewer-availability-hint\[hidden\]/);
  assert.match(css, /\.viewer-track-quick\[hidden\]/);
  assert.match(css, /\.viewer-race-nav\[hidden\]/);
  assert.match(css, /\.viewer-global-legend-shell\[hidden\]/);
  assert.match(css, /display:\s*none\s*!important/);
});
