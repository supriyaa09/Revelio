import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Native and wasm-backed packages must stay external — webpack cannot bundle
  // .node binaries or tesseract's worker/wasm assets.
  serverExternalPackages: ['@napi-rs/canvas', 'tesseract.js', 'unpdf'],
  experimental: {
    // Uploads go through Server Actions; raise the body cap to our app-level
    // file limit.
    serverActions: { bodySizeLimit: '25mb' },
    /*
     * lucide-react ships ~1,500 icon modules behind a barrel file. Importing
     * four icons from it pulls the whole barrel into the module graph, which the
     * dev compiler then has to walk on every change — the single largest source
     * of sluggish navigation in development here. This rewrites the barrel
     * imports to direct per-icon paths.
     */
    optimizePackageImports: ['lucide-react'],
  },
};

export default nextConfig;
