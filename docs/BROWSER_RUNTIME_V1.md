# Local Chrome runtime v1

## Purpose

The two browser tests previously each searched only `which google-chrome/google-chrome-stable/chromium/chromium-browser`. They could not use an explicit path or a locally downloaded Chrome for Testing runtime. This change provides a shared resolver, an explicit installer and a real headless rendering check. The browser assertions remain unchanged; no test is skipped.

## Commands

```sh
npm ci
npm ci --prefix mcp
npm run browser:install
npm run browser:check
npm run test:browser
npm run check
```

For a container that cannot start full Chrome (for example, restricted UNIX sockets), an explicit supported alternative is:

```sh
npm run browser:install -- --headless-shell
npm run browser:check
npm run test:browser
npm run check
```

Headless Shell is the official standalone older headless implementation, not identical to unified full Chrome. Always report which binary was tested. CI continues to use a usable installed system Chrome when available. Local Shell success does not claim that every full-Chrome/platform behavior has been verified locally.

The installer pins Chrome for Testing to `config/browser-runtime.json` (155.0.8059.84 at this revision) and uses exactly pinned `@puppeteer/browsers` 2.13.2 as a development dependency. Its Node >=18 requirement remains compatible with the repository's Node >=20 requirement. Normal npm install/check/test does not download Chrome or modify system packages. `npm run check` remains the full suite.

For full Chrome on supported Debian/Ubuntu systems, `npm run browser:install -- --install-deps` explicitly requests system dependencies through the official installer and requires suitable privileges. This option is not silently applied, and is not supported in combination with `--headless-shell`. Missing libraries, network restrictions, unsupported platforms and permission errors remain failures rather than skips.

## Resolution order

1. `CHASS_CHROME_PATH`, then `CHROME_BIN`, then `PUPPETEER_EXECUTABLE_PATH`. A configured invalid path fails with instructions rather than silently falling back.
2. A working system Chrome/Chromium executable on PATH, plus usual macOS/Windows full-Chrome installation locations.
3. This checkout's `.cache/chass-browser/runtime.json`, pointing at the pinned managed installation. Override the cache location explicitly with `CHASS_BROWSER_CACHE_DIR` if necessary.

Every selected executable is probed with `--version`. The managed manifest is bounded and its version/path validated, including realpath containment to prevent symlink escapes. Probes use argument arrays without a shell. `browser:check` additionally launches a headless renderer against a small data URL, checks rendered output and cleans its temporary profile. Version availability alone is not reported as rendering success.

The installer publishes its manifest only after extraction and version verification. A render check remains separate so an environment where rendering is blocked can retain the installed binary and receive an explicit `CHASS_CHROME_LAUNCH_FAILED` result. It never bypasses the host's socket restrictions or changes security policy. Existing browser tests already used `--no-sandbox` for isolated root CI; no production browser/security settings are changed.

## Boundaries

This is development/test infrastructure only. No application predictions, EARLY evidence, frozen marks, 💎/⚠️, source records, D1 data, application feature flags or production workflows are changed. Downloaded binaries, partial archives and machine-specific manifests are ignored by git and excluded from the patch package. A fresh execution workspace needs an installer run or a usable system/explicit-path browser.

`npm run test:browser` runs both existing real-browser tests. Unit tests cover detection priority, invalid overrides, missing binaries, version checks, cache bounds/path escapes, shell-free argument passing, render failures and profile cleanup. Full integration must still pass at the exact GitHub PR head/base before merge.

## Sources

- https://pptr.dev/browsers-api
- https://developer.chrome.com/docs/automation-and-testing/headless

This revision was executed on Linux. The macOS/Windows detection branches and full regression suite on those platforms were not executed here.
