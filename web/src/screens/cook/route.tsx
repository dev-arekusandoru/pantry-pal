import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "@/app/routes";
import { validateCookSearch } from "../recipe/lib";
import { CookScreen } from "./CookScreen";

export const cookRoute = createRoute({
  // Child of the root, not the shell: cook mode is full screen with no nav.
  getParentRoute: () => rootRoute,
  path: "/recipes/$slug/cook",
  validateSearch: validateCookSearch,
  component: CookPage,
});

function CookPage() {
  const { slug } = cookRoute.useParams();
  const { cookEvent, servings, resume, from } = cookRoute.useSearch();
  return (
    <CookScreen
      slug={slug}
      {...(cookEvent !== undefined ? { cookEvent } : {})}
      {...(servings !== undefined ? { servings } : {})}
      {...(resume !== undefined ? { resume } : {})}
      {...(from !== undefined ? { from } : {})}
    />
  );
}
