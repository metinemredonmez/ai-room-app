import { discovery, llmsTxt } from "@/lib/llms";

// API.md §7.53: a short Markdown map of the site for AI assistants; 404 while the admin has them switched off.
export async function GET() {
  if (!(await discovery()).aiAssistants) return new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(await llmsTxt(), { headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" } });
}
