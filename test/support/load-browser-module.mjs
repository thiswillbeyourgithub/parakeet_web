/**
 * Helper for unit-testing browser JS files that attach to a bare `window`
 * instead of using ES module exports. Evaluates the file in a vm context with a
 * minimal browser-like global (window, crypto, console, logger stub) and returns
 * the populated window object.
 *
 * Most modules under app/src and app/ui/src/lib export cleanly and should be
 * `import`ed directly; reach for this only when a file expects browser globals
 * with no export surface. Ported from WebSend's test/support helper.
 *
 * Usage:
 *   const win = await loadBrowserModule('/abs/path/to/module.js');
 *   const { SomeClass } = win;
 *
 * Built with Claude Code.
 */

import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const stubLogger = {
  info: () => {},
  success: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

export async function loadBrowserModule(filePath, extraGlobals = {}) {
  const code = readFileSync(filePath, 'utf8');

  const win = { logger: stubLogger, ...extraGlobals };

  // Both window properties AND bare names (e.g. `logger`, `crypto`) must be
  // available in the vm context since browser globals are accessed without a
  // prefix.
  const context = createContext({
    window: win,
    logger: stubLogger,
    crypto: globalThis.crypto,
    console,
    ...extraGlobals,
  });

  runInContext(code, context);

  return context.window;
}
