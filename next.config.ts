import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run 用に、node_modules なしで動く最小構成を .next/standalone に出力する
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
