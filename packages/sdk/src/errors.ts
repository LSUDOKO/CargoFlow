/**
 * Every failure of a CargoFlow API call. `status` is the HTTP status (0 when the API could not be reached), `code`
 * the API's stable error code (`not_found`, `chain_rejected`, `replayed`, `rate_limited`, ...) or one of the SDK's
 * own: `unreachable`, `timeout`, `http_error` (a non-JSON error body) and `bad_response` (the body did not match
 * the expected schema; `issues` says where).
 */
export class CargoFlowApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly path: string;
  readonly issues?: unknown;

  constructor(status: number, code: string, message: string, path = "", issues?: unknown) {
    super(message);
    this.name = "CargoFlowApiError";
    this.status = status;
    this.code = code;
    this.path = path;
    this.issues = issues;
  }

  /** 404, 405, 501 and 503: the deployment does not offer this endpoint or channel (rather than a failure). */
  get unavailable(): boolean {
    return [404, 405, 501, 503].includes(this.status);
  }
}

export const isCargoFlowApiError = (e: unknown): e is CargoFlowApiError => e instanceof CargoFlowApiError;
