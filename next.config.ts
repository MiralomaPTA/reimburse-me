import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The app is fully dynamic and sign-in gated, so the classic dynamic
  // rendering model is simpler than Cache Components here.
  cacheComponents: false,
  // The PDF form template is read from disk at request time; make sure it is
  // bundled with every serverless function on Vercel.
  outputFileTracingIncludes: {
    "/*": ["./assets/**/*"],
    "/**": ["./assets/**/*"],
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
