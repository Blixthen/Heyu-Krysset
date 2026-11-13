import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

// Gives `next dev` the Worker's bindings (a local stand-in for the R2 photo bucket).
initOpenNextCloudflareForDev();

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
