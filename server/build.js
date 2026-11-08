/* Bundle the Express backend into one file for Netlify Functions: dist/functions/api.js */
const path = require('path');
const esbuild = require('esbuild');

esbuild.build({
  entryPoints: [path.join(__dirname, 'netlify', 'api.js')],
  outfile: path.join(__dirname, 'dist', 'functions', 'api.js'),
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['pg-native'],
  legalComments: 'linked',
  logLevel: 'warning'
}).then(() => console.log('built dist/functions/api.js'))
  .catch(() => process.exit(1));
