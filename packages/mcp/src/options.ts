import type { ServerOptions } from "./context.js";

export interface CliArgs {
  http?: number;
  host: string;
  help: boolean;
  options: ServerOptions;
}

const USAGE = `cargoflow-mcp: the CargoFlow MCP server (stdio by default)

  --http <port>             serve Streamable HTTP on http://<host>:<port>/mcp instead of stdio
  --host <host>             interface for --http (default 127.0.0.1)
  --api-url <url>           CargoFlow API (env CARGOFLOW_API_URL; default the live API)
  --app-url <url>           web app for signing links (env CARGOFLOW_APP_URL)
  --gateway-key-file <path> enable submit_readings_csv with this gateway key file (env CARGOFLOW_GATEWAY_KEY_FILE)
  --rpc-url <url>           RPC for on-chain reads (env CARGOFLOW_RPC_URL)

It never accepts or stores a wallet private key and never signs transactions.`;

export const usage = () => USAGE;

/** Options from the environment; flags override them. */
export function optionsFromEnv(env: Record<string, string | undefined>): ServerOptions {
  return {
    apiUrl: env.CARGOFLOW_API_URL || undefined,
    appUrl: env.CARGOFLOW_APP_URL || undefined,
    gatewayKeyFile: env.CARGOFLOW_GATEWAY_KEY_FILE || undefined,
    rpcUrl: env.CARGOFLOW_RPC_URL || undefined,
  };
}

export function parseArgs(argv: string[], env: Record<string, string | undefined> = {}): CliArgs {
  const out: CliArgs = { host: "127.0.0.1", help: false, options: optionsFromEnv(env) };
  const value = (i: number, flag: string) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value.`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const [flag, inline] = a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, undefined];
    const take = () => (inline !== undefined ? inline : value(i++, flag));
    switch (flag) {
      case "--http": {
        const port = Number(take());
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--http needs a port number.");
        out.http = port;
        break;
      }
      case "--host": out.host = take(); break;
      case "--api-url": out.options.apiUrl = take(); break;
      case "--app-url": out.options.appUrl = take(); break;
      case "--gateway-key-file": out.options.gatewayKeyFile = take(); break;
      case "--rpc-url": out.options.rpcUrl = take(); break;
      case "-h":
      case "--help": out.help = true; break;
      default:
        if (/private|secret|mnemonic/i.test(flag)) throw new Error(`${flag}: this server never accepts wallet keys; sign transactions in your own wallet.`);
        throw new Error(`Unknown option ${flag}. Run with --help.`);
    }
  }
  return out;
}
