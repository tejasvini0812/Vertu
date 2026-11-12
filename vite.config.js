import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import { sitePlugin } from './scripts/site-plugin.mjs';
import { viteSingleFile } from 'vite-plugin-singlefile';

// npm run build               -> dist/               storefront at /, admin at /admin/
// npm run build:single        -> dist-single/        storefront as one self-contained html file
// npm run build:single:admin  -> dist-single-admin/  admin as one self-contained html file
const single = process.env.SINGLE === '1';
const admin = process.env.ENTRY === 'admin';

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
  // the build's identity, shown with browser errors in System health
  const release = (env.COMMIT_REF || env.CF_PAGES_COMMIT_SHA || env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || new Date().toISOString().slice(0, 16)).slice(0, 12);
  return {
  base: './',
  define: { __RELEASE__: JSON.stringify(release) },
  plugins: single ? [viteSingleFile()] : [sitePlugin(env)],
  build: {
    target: 'es2022', // top-level await: the storefront waits for the catalogue before building
    outDir: single ? (admin ? 'dist-single-admin' : 'dist-single') : 'dist',
    assetsInlineLimit: single ? 100_000_000 : 4096,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: single
        ? resolve(admin ? 'admin/index.html' : 'index.html')
        : {
            main: resolve('index.html'),
            shop: resolve('shop/index.html'),
            product: resolve('product/index.html'),
            account: resolve('account/index.html'),
            checkout: resolve('checkout/index.html'),
            order: resolve('order/index.html'),
            newsletter: resolve('newsletter/index.html'),
            invoice: resolve('invoice/index.html'),
            legal: resolve('legal/index.html'),
            contact: resolve('contact/index.html'),
            admin: resolve('admin/index.html'),
          },
    },
  },
};
});
