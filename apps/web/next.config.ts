import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["three"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
