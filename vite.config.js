import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url)).split(path.sep).join('/').replace(/[\\()[\]{}*?!+]/g, '\\$&');
const artifacts = ['.security-stage-*', '.security-stage-*/**', 'output/**', 'release/**', 'dist/**'];
export default ({ command, mode }) => ({
  base: './',
  define: { __SOUND_LAB_DEBUG_TOOLS__: command === 'serve' || mode === 'desktop-test' },
  plugins: command === 'serve' ? [{
    name: 'sound-lab-dev-csp',
    transformIndexHtml: html => html.replace("connect-src 'self';", "connect-src 'self' ws://127.0.0.1:*;"),
  }] : [],
  server: {
    host: '127.0.0.1', port: 5240, strictPort: true,
    watch: { ignored: artifacts.map(pattern => `**/${pattern}`) },
    // Scope artifact rules to this checkout. Vite itself serves a client module
    // from node_modules/vite/dist, which must remain available in development.
    fs: { deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**',
      ...artifacts.map(pattern => root + pattern)] },
  },
});
