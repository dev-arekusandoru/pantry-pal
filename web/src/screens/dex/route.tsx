import { createRoute } from "@tanstack/react-router";
import { shellRoute } from "@/app/routes";
import { DexScreen } from "./DexScreen";

export const dexRoute = createRoute({ getParentRoute: () => shellRoute, path: "/dex", staticData: { tab: "pantry" }, component: DexScreen });
