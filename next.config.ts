import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/plans/route': [
      './scripts/parse_plan_pdf.py',
      './.python_packages/**/*'
    ]
  }
};

export default nextConfig;
