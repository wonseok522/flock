import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // the dev badge overlaps the bottom tab bar on phones and on the projector
  devIndicators: false,
  partialPrefetching: true,
  turbopack: {
    // the repo root has its own package.json for scripts/, so pin the app root
    root: path.resolve(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
