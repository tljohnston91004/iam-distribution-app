import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  // Avoid Next.js blocking hard-refresh assets when using http://127.0.0.1:3002
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
