// Copies the admin panel's static files and the vendored Preact/htm build into
// dist/admin-ui. Runs after `tsc -p tsconfig.admin-ui.json` in `npm run build`.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'dist', 'admin-ui');
mkdirSync(join(target, 'vendor'), { recursive: true });
for (const file of readdirSync(join(root, 'admin-ui'))) {
  if (/\.(html|css|svg)$/.test(file)) copyFileSync(join(root, 'admin-ui', file), join(target, file));
}
copyFileSync(join(root, 'node_modules', 'htm', 'preact', 'standalone.module.js'), join(target, 'vendor', 'preact-htm.js'));
