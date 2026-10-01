import type { z } from "zod";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");

/** Every API failure. status 0 means the backend could not be reached. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<S extends z.ZodTypeAny>(method: string, path: string, schema: S, body?: unknown): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "unreachable", "The CargoFlow backend could not be reached.");
  }
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(res.status, e?.code ?? "http_error", e?.message ?? `Request failed with status ${res.status}.`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(res.status, "bad_response", `Unexpected response from ${path}.`);
  }
  return parsed.data;
}

export const apiGet = <S extends z.ZodTypeAny>(path: string, schema: S) => request("GET", path, schema);
export const apiPost = <S extends z.ZodTypeAny>(path: string, body: unknown, schema: S) => request("POST", path, schema, body);

/** WebSocket URL for a shipment's live events. */
export function wsURL(apiURL: string, shipmentId: string): string {
  const base = apiURL.replace(/\/+$/, "").replace(/^http/, "ws");
  return `${base}/v1/ws?shipment=${shipmentId}`;
}
