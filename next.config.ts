import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the dev server to accept requests from devices on the local network
  // (e.g. judges' phones at http://192.168.x.x:5000). Without this, Next.js
  // blocks cross-origin dev requests, which breaks post-login navigation.
  allowedDevOrigins: ["192.168.1.62", "192.168.1.*"],
  devIndicators : false
};

export default nextConfig;
