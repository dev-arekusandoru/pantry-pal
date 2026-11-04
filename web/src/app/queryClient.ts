import { createQueryClient, errorMessage } from "../api";
import { toast } from "../ui";

/** App-wide client. Failed mutations toast unless they set `meta: { silent: true }`. */
export const queryClient = createQueryClient((error, fallback) => {
  toast.error(fallback ?? errorMessage(error));
});
