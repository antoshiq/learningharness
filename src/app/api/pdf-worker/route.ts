import fs from "node:fs";
import path from "node:path";

/** pdf.js renders pages in a web worker; its script is served from the installed package. */
export const GET = () => {
  const file = path.join(process.cwd(), "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
  return new Response(fs.readFileSync(file), { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=604800" } });
};
