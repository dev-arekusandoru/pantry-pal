import { MutationCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./errors";

/** Mutations with `meta: { silent: true }` skip the global error toast. */
declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: { silent?: boolean; errorMessage?: string };
  }
}

/** Retry transport failures and 5xx a couple of times; never retry 4xx. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.isClientError) return false;
  return failureCount < 2;
}

export function createQueryClient(onMutationError?: (error: unknown, fallback?: string) => void): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
    mutationCache: new MutationCache({
      onError(error, _vars, _ctx, mutation) {
        if (mutation.meta?.silent) return;
        onMutationError?.(error, mutation.meta?.errorMessage);
      },
    }),
  });
}
