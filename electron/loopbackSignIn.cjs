const http = require('http');

// electron/loopbackSignIn.cjs
// A sign-in page that a page of the app opens in the listener's own browser and that comes back
// to a loopback address (authorization code with PKCE, done by the page itself). This process
// opens the page and, while the attempt lasts, answers the one address it comes back to, handing
// the address's query (`code`, `state` or `error`) to the windows of the app. It knows no platform
// and keeps no code: the page that asked checks the `state` and exchanges the code.

// How long an attempt waits for the browser to come back.
const ATTEMPT_MS = 10 * 60 * 1000;
// The addresses it may listen on: loopback, a port of its own (not a privileged one).
const MIN_PORT = 1024;
const MAX_PORT = 65535;
const PATH_PATTERN = /^\/[A-Za-z0-9._/-]{1,100}$/;

// The page the browser is left on: the only text of this shown outside the app's window.
const pageOf = refused => `<!doctype html><meta charset="utf-8"><title>Folia</title><body style="margin:0;display:grid;place-items:center;height:100vh;background:#121212;color:#fff;font:16px system-ui,sans-serif;text-align:center">${
  refused ? 'Not authorized. Try again in Folia.<br>未授權，請回到 Folia 重試。' : 'You can go back to Folia now.<br>可以回到 Folia 了。'
}</body>`;

/**
 * `send(query)` hands the answer to the app's windows; `openExternal(url)` opens the page in the
 * listener's browser. One attempt at a time: a new one ends the one before.
 */
function createLoopbackSignIn({ send, openExternal, createServer = () => http.createServer(), log = console.log }) {
  let attempt = null;

  const end = () => {
    if (!attempt) return;
    clearTimeout(attempt.timer);
    attempt.server.close();
    attempt = null;
  };

  return {
    /** Opens `url` in the browser and answers `http://127.0.0.1:<port><path>` until it comes back once. */
    async open({ url, port, path }) {
      const page = new URL(String(url));
      if (page.protocol !== 'https:') throw new Error('A sign-in page must be https');
      if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) throw new Error('Invalid sign-in port');
      if (typeof path !== 'string' || !PATH_PATTERN.test(path)) throw new Error('Invalid sign-in path');
      end();
      const server = createServer();
      server.on('request', (request, response) => {
        const address = new URL(request.url || '/', `http://127.0.0.1:${port}`);
        if (address.pathname !== path) {
          response.writeHead(404).end();
          return;
        }
        const query = Object.fromEntries(['code', 'state', 'error'].map(name => [name, address.searchParams.get(name) || undefined]));
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(pageOf(Boolean(query.error)));
        log(`[SignIn] The browser came back to ${port}${path}${query.error ? ' with a refusal' : ''}`);
        send(query);
        end();
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
      attempt = { server, timer: setTimeout(end, ATTEMPT_MS) };
      log(`[SignIn] Waiting on 127.0.0.1:${port} for 10 min`);
      await openExternal(page.toString());
    },
    close: end,
  };
}

module.exports = { createLoopbackSignIn };
