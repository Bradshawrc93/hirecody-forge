import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure the Chart.js UMD bundle is traced into serverless deployments.
  // html-report.ts reads this file at runtime via fs.readFileSync to inline
  // it into LLM-generated HTML reports.
  outputFileTracingIncludes: {
    "/api/internal/**/*": ["./node_modules/chart.js/dist/chart.umd.min.js"],
    "/agents/**/*": ["./node_modules/chart.js/dist/chart.umd.min.js"],
  },
  // Don't bundle isomorphic-dompurify / jsdom — its transitive dep
  // html-encoding-sniffer@6 does require() on an ESM-only @exodus/bytes,
  // which Vercel's bundled CJS output can't load. Leaving these external
  // lets Node 22.12+ handle require(esm) natively at runtime.
  serverExternalPackages: ["isomorphic-dompurify", "jsdom"],
};

export default nextConfig;
