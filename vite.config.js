import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// npm run build               -> dist/               storefront at /, admin at /admin/
// npm run build:single        -> dist-single/        storefront as one self-contained html file
// npm run build:single:admin  -> dist-single-admin/  admin as one self-contained html file
const single = process.env.SINGLE === '1';
const admin = process.env.ENTRY === 'admin';

export default defineConfig({
  base: './',
  plugins: single ? [viteSingleFile()] : [],
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
            admin: resolve('admin/index.html'),
          },
    },
  },
});
