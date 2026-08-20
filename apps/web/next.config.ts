import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@cco/contracts", "@cco/domain", "@cco/shared"]
};

export default nextConfig;
