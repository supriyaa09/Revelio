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
  },
};

export default nextConfig;
