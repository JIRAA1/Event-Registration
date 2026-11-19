import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build, loadEnv} from 'vite';
import tailwind from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const mobile = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(mobile);
process.chdir(root);
const offline = process.argv.includes('--offline-scanner');
const env = offline ? {} : loadEnv('production', root, 'NEXT_PUBLIC_');
const url = offline ? null : new URL(env.NEXT_PUBLIC_SUPABASE_URL);
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!offline && (url.protocol !== 'https:' || !key)) throw new Error('Configure the HTTPS Supabase URL and publishable key first.');
const site = offline ? new URL('https://appassets.androidplatform.net') : new URL(process.env.EVENT_PASS_PUBLIC_SITE || 'https://event-registration-six-amber.vercel.app');
if (site.protocol !== 'https:') throw new Error('Public site must use HTTPS.');
await build({
  root: mobile,
  build: {outDir: offline ? path.join(root,'tmp/offline-apk/assets') : 'dist'},
  publicDir: path.join(root,'public'),
  define: {
    'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(url?.origin || ''),
    'process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(key || ''),
    'process.env.NEXT_PUBLIC_OFFLINE_SCANNER': JSON.stringify(String(offline)),
    'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': 'undefined',
    'process.env.NEXT_PUBLIC_NATIVE_PUBLIC_SITE': JSON.stringify(site.origin),
  },
  resolve: {alias: {'@': root, 'next/image': path.join(mobile,'image.jsx')}},
  esbuild: {jsx: 'automatic'},
  css: {postcss: {plugins: [tailwind(path.join(root,'tailwind.config.ts')), autoprefixer()]}},
});
