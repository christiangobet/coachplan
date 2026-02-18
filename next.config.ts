import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export default nextConfig;
