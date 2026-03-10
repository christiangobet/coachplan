import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withSentryConfig } from "@sentry/nextjs";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  outputFileTracingIncludes: {
    '/api/plans/route': [
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
    ]
  }
};

export default withSentryConfig(nextConfig, {
  // Suppress source map upload during local dev (set SENTRY_AUTH_TOKEN in CI)
  silent: true,
  // Disable automatic instrumentation tree-shaking in dev for faster builds
  disableLogger: true,
});
