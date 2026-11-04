import createClient from "openapi-fetch";
import { connection } from "./connection";
import { NetworkError, UNREACHABLE_STATUSES, toApiError } from "./errors";
import type { paths } from "./schema";

/**
 * fetch wrapper: turns transport failures (and proxy gateway errors) into
 * NetworkError and keeps the global reachability flag up to date.
 */
const trackedFetch: typeof fetch = async (input, init) => {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (cause) {
    // AbortError is a cancelled query, not an outage.
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    connection.markUnreachable();
    throw new NetworkError("Can't reach PantryPal", { cause });
  }
  if (UNREACHABLE_STATUSES.has(res.status)) {
    connection.markUnreachable();
    throw new NetworkError("Can't reach PantryPal");
  }
  connection.markReachable();
  return res;
};

/**
 * Typed client for /api/v1. Paths are relative to the base URL, so write
 * `client.GET("/pantry")`, not `/api/v1/pantry`.
 *
 * Prefer `unwrap(client.GET(...))` in query/mutation functions: it returns the
 * data or throws ApiError, which is what TanStack Query wants.
 */
export const client = createClient<paths>({
  // Absolute (same origin) because openapi-fetch builds `new Request(url)`, which
  // rejects relative URLs outside a browser (jsdom tests, Node).
  baseUrl: `${globalThis.location?.origin ?? "http://localhost"}/api/v1`,
  // Wrapped lazily so tests can stub the global fetch after import.
  fetch: (req) => trackedFetch(req),
});

interface FetchResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/**
 * Await an openapi-fetch call and return its data, or throw ApiError built from
 * the `{ error: { code, message } }` body. 204 responses resolve to `undefined`.
 */
export async function unwrap<T>(request: Promise<FetchResult<T>>): Promise<T> {
  const { data, error, response } = await request;
  if (!response.ok) throw toApiError(response.status, error);
  return data as T;
}
