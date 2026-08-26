import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@cco/contracts", "@cco/domain", "@cco/shared"]
};

export default nextConfig;
