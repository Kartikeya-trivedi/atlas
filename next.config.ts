import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // pdf.js ships its own worker and optional canvas bindings. Leaving them to
  // the bundler produces "module not found" noise for dependencies unpdf never
  // loads on the server; externalising keeps them as plain requires.
  serverExternalPackages: ["unpdf", "mammoth"],
};

export default nextConfig;
