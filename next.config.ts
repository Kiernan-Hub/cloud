import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle for the Dockerfile. Keeps the
  // deployable artifact portable between hosts (ADR 0003).
  output: "standalone",
};

export default nextConfig;
