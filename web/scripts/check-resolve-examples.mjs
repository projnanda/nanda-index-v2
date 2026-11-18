import assert from "node:assert/strict";
const origin = new URL(process.argv[2] ?? "http://127.0.0.1:3000").origin;
async function json(url, init) {
  const target = new URL(url, origin);
  assert.equal(target.origin, origin, "Example must remain on its controlled origin");
  const response = await fetch(target, { ...init, redirect: "error", signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, `${target.pathname} returned ${response.status}`);
  return response.json();
}
for (const kind of ["catalog", "smb", "personal"]) {
  const resolved = await json(`/api/resolve-examples/${kind}/index`);
  assert.equal(resolved.entry.extensions["org.projectnanda"].demonstration, true);
  const direct = resolved.entry.type === "application/a2a-agent-card+json";
  const source = await json(direct ? resolved.entry.url : `${resolved.entry.url}/agents/${encodeURIComponent(resolved.identifier)}`);
  const card = direct ? source : await json(source.url);
  assert.equal(typeof card.name, "string");
  assert.ok(Array.isArray(card.skills));
  const reply = await json(`${card.url}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "CI example check" }) });
  assert.equal(reply.demonstration, true);
  console.log(`${kind}: index, source, card and demonstration runtime passed`);
}
