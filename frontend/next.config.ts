import type { NextConfig } from "next";

// The browser only talks to Next.js; /api/* is proxied to the FastAPI service.
const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  async redirects() {
    return [
      { source: "/technical", destination: "/stocks", permanent: true },
      { source: "/fundamentals", destination: "/stocks", permanent: true },
      { source: "/sharpe", destination: "/portfolios", permanent: true },
    ];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backendUrl}/api/:path*` }];
  },
};

export default nextConfig;
