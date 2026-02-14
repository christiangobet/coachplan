import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/plans/route': [
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
    ]
  }
};

export default nextConfig;
