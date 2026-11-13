import type { NextConfig } from "next";

// Strict mode double-mounts drei's <Html> labels in dev, which only produces console noise.
const config: NextConfig = { reactStrictMode: false };
export default config;
