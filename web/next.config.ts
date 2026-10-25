import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return ["moonpay", "transak", "balances", "custody"].map(service => ({
      source: `/api/${service}/:path*`,
      destination: `${process.env.WALLET_API_URL || "http://127.0.0.1:8080"}/api/${service}/:path*`,
    }));
  },
  /* config options here */
  experimental: {
    agentFeedback: false,
  },
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
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
