import type { NextConfig } from "next";

// LAN addresses allowed to load dev assets (set by scripts/run.mjs in --lan mode).
const allowedDevOrigins = (process.env.TUTOR_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins,
  devIndicators: false,
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
