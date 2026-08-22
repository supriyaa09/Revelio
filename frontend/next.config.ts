import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Uploads go through Server Actions; raise the body cap to our app-level file limit.
    serverActions: { bodySizeLimit: '25mb' },
  },
};

export default nextConfig;
