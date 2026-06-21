import { join } from 'path';

/**
 * Static UI file serving.
 * GET  /           → index.html
 * GET  /index.js   → index.js
 * GET  /index.css  → index.css
 */
export function createUiRoutes(publicDir) {
  function serve(file, contentType) {
    return async (c) => {
      try {
        const content = await Bun.file(join(publicDir, file)).text();
        return new Response(content, {
          headers: { 'Content-Type': contentType },
        });
      } catch {
        return c.text('Not Found', 404);
      }
    };
  }

  return {
    index: serve('index.html', 'text/html'),
    js: serve('index.js', 'application/javascript'),
    css: serve('index.css', 'text/css'),
  };
}
