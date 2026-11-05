import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { Tooltip } from "radix-ui";
import { ToastHost } from "../ui";
import { queryClient } from "./queryClient";
import { router } from "./router";
import { BrowserSession } from "./BrowserSession";

export function App() {
  return (
    <Tooltip.Provider>
      <QueryClientProvider client={queryClient}>
        <BrowserSession>
          <RouterProvider router={router} />
        </BrowserSession>
        <ToastHost />
      </QueryClientProvider>
    </Tooltip.Provider>
  );
}
