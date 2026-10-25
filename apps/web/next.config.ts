import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow an isolated verification build while the local dev server is running.
  distDir: process.env.HUNTER_NEXT_DIST_DIR ?? ".next",
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
