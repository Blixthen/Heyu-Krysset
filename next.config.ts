import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Do not enable cacheComponents: page renders hang on Cloudflare Workers.
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
