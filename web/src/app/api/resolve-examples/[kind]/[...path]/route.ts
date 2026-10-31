import { exampleResponse, isExampleKind } from "@/lib/resolveExamples";

type Context = { params: Promise<{ kind: string; path: string[] }> };
export async function GET(request: Request, context: Context) {
  const { kind, path } = await context.params;
  // Next's local server may normalize request.url to localhost. Preserve the
  // browser-facing host so example links stay same-origin (including ports).
  const origin = new URL(request.url);
  origin.host = request.headers.get("host") ?? origin.host;
  const body = exampleResponse(kind, path, origin.origin);
  return body === null ? Response.json({ error: "Example resource not found" }, { status: 404 }) : Response.json(body);
}

export async function POST(_request: Request, context: Context) {
  const { kind, path } = await context.params;
  if (!isExampleKind(kind) || path.join("/") !== "runtime/run") return Response.json({ error: "Example resource not found" }, { status: 404 });
  // Do not parse, retain or echo the caller's task text. This is a fixed demo.
  return Response.json({ demonstration: true, message: "The controlled example completed. No external service was called." });
}
