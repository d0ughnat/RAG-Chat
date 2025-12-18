import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure proper handling for serverless functions on Vercel
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // Add headers to prevent caching issues
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
    ];
  },
};

export default nextConfig;
