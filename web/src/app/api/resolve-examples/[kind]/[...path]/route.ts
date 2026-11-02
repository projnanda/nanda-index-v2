import { exampleResponse, isExampleKind } from "@/lib/resolveExamples";

type Context = { params: Promise<{ kind: string; path: string[] }> };
export async function GET(_request: Request, context: Context) {
  const { kind, path } = await context.params;
  // Root-relative links: the client resolves them against the origin it is
  // already on. Building them from the Host header leaked the internal port
  // behind the proxy (https://nandaindex.org:3000/…) and reflected any Host.
  const body = exampleResponse(kind, path);
  return body === null ? Response.json({ error: "Example resource not found" }, { status: 404 }) : Response.json(body);
}

export async function POST(_request: Request, context: Context) {
  const { kind, path } = await context.params;
  if (!isExampleKind(kind) || path.join("/") !== "runtime/run") return Response.json({ error: "Example resource not found" }, { status: 404 });
  // Do not parse, retain or echo the caller's task text. This is a fixed demo.
  return Response.json({ demonstration: true, message: "The controlled example completed. No external service was called." });
}
