/** Domain error codes shared by REST and MCP adapters. */
export type ErrorCode =
  | "not_found"
  | "conflict"
  | "validation"
  | "unprocessable"
  | "unauthorized"
  | "unavailable";

const HTTP_STATUS: Record<ErrorCode, number> = {
  not_found: 404,
  conflict: 409,
  validation: 400,
  unprocessable: 422,
  unauthorized: 401,
  unavailable: 503,
};

/** HTTP status for a domain error code. */
export function httpStatusFor(code: ErrorCode): number {
  return HTTP_STATUS[code];
}

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

/**
 * Domain error. Throw from services; REST maps it to `{ error: { code, message, details } }`
 * with the status above, MCP tools return `isError: true` with the same body.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return httpStatusFor(this.code);
  }

  toBody(): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
