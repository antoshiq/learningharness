import type { NextConfig } from "next";

// LAN addresses allowed to load dev assets (set by scripts/run.mjs in --lan mode).
const allowedDevOrigins = (process.env.TUTOR_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@anthropic-ai/claude-agent-sdk"],
  allowedDevOrigins,
  devIndicators: false,
  experimental: {
    // src/proxy.ts makes Next buffer request bodies, by default only 10 MB.
    // Textbooks are uploaded whole (up to 100 MB), PDF materials as base64.
    proxyClientMaxBodySize: "150mb",
  },
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
