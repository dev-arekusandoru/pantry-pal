/** Server error envelope: `{ error: { code, message, details? } }`. */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** The server answered with a non-2xx status. */
export class ApiError extends Error {
  override readonly name = "ApiError";

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  /** 4xx: the request itself was wrong; retrying will not help. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

/** Gateway statuses: a proxy (Vite dev, tailscale) answered because the app behind it is down. */
export const UNREACHABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

/** The server could not be reached at all (offline, down, proxy 502/503/504). */
export class NetworkError extends Error {
  override readonly name = "NetworkError";

  constructor(message = "Can't reach PantryPal", options?: { cause?: unknown }) {
    super(message, options);
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const e = (value as { error: unknown }).error;
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as { code?: unknown }).code === "string" &&
    typeof (e as { message?: unknown }).message === "string"
  );
}

/** Build an ApiError from a response status and its parsed (or missing) body. */
export function toApiError(status: number, body: unknown): ApiError {
  if (isApiErrorBody(body)) {
    return new ApiError(status, body.error.code, body.error.message, body.error.details);
  }
  return new ApiError(status, "unknown", `Request failed (${status})`);
}

/** True for failures that mean "the server is not there" rather than "it said no". */
export function isUnreachable(error: unknown): boolean {
  return error instanceof NetworkError;
}

/** Human-readable message for any thrown value, for toasts and error states. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong";
}
