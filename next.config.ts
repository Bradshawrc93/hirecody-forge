import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure the Chart.js UMD bundle is traced into serverless deployments.
  // html-report.ts reads this file at runtime via fs.readFileSync to inline
  // it into LLM-generated HTML reports.
  outputFileTracingIncludes: {
    "/api/internal/**/*": ["./node_modules/chart.js/dist/chart.umd.min.js"],
    "/agents/**/*": ["./node_modules/chart.js/dist/chart.umd.min.js"],
  },
};

export default nextConfig;
