import { createRoute } from "@tanstack/react-router";
import { shellRoute } from "@/app/routes";
import { RecipeEditorScreen } from "./RecipeEditor";

export const newRecipeRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/recipes/new",
  staticData: { tab: "recipes", hideNavOnMobile: true },
  component: () => <RecipeEditorScreen />,
});

export const editRecipeRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/recipes/$slug/edit",
  staticData: { tab: "recipes", hideNavOnMobile: true },
  component: EditRecipePage,
});

function EditRecipePage() {
  const { slug } = editRecipeRoute.useParams();
  return <RecipeEditorScreen key={slug} slug={slug} />;
}
