import { discovery, llmsFullTxt } from "@/lib/llms";

// API.md §7.53: /llms.txt plus tools, styles, rooms, the FAQ and the articles; 404 while AI assistants are switched off.
export async function GET() {
  if (!(await discovery()).aiAssistants) return new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(await llmsFullTxt(), { headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" } });
}
