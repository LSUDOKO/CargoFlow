// Node entry: the runtime-neutral server plus local file access (verify_document by path) and the gateway tool.
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { LocalFileReader, ServerOptions } from "./context.js";
import { buildCargoFlowServer, VERSION } from "./core.js";
import { Refusal } from "./format.js";
import { registerGatewayTools } from "./tools/gateway.js";

export { VERSION };

const readLocalFile: LocalFileReader = async (path, maxBytes) => {
  const st = await stat(path).catch(() => {
    throw new Refusal(`No readable file at ${path}.`);
  });
  if (!st.isFile()) throw new Refusal(`${path} is not a file.`);
  if (st.size > maxBytes) throw new Refusal(`The file is larger than ${maxBytes / 1024 / 1024} MB.`);
  return { name: basename(path), bytes: new Uint8Array(await readFile(path)) };
};

/** Builds a CargoFlow MCP server. It holds no private keys and never signs transactions. */
export function createCargoFlowServer(options: ServerOptions = {}) {
  if (options.hosted) return buildCargoFlowServer(options);
  return buildCargoFlowServer(options, { readLocalFile, register: registerGatewayTools });
}
