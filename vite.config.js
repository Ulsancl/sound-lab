const artifacts = ['**/.security-stage-*', '**/.security-stage-*/**', '**/output/**', '**/release/**', '**/dist/**'];
export default ({ command }) => ({
  base: './',
  plugins: command === 'serve' ? [{
    name: 'sound-lab-dev-csp',
    transformIndexHtml: html => html.replace("connect-src 'self';", "connect-src 'self' ws://127.0.0.1:*;"),
  }] : [],
  server: {
    host: '127.0.0.1', port: 5240, strictPort: true,
    watch: { ignored: artifacts },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', ...artifacts] },
  },
});
