import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { Tooltip } from "radix-ui";
import { ToastHost } from "../ui";
import { queryClient } from "./queryClient";
import { router } from "./router";

export function App() {
  return (
    <Tooltip.Provider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <ToastHost />
      </QueryClientProvider>
    </Tooltip.Provider>
  );
}
