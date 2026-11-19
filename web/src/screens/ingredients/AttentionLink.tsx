import { Link } from "@tanstack/react-router";
import { VisuallyHidden } from "radix-ui";
import { Pill, buttonClass } from "@/ui";
import { useReviewList } from "./queries";

/** Link to the ingredients that need attention, with how many there are. Renders nothing when none do. */
export function AttentionLink({ variant = "ghost" }: { variant?: "ghost" | "secondary" }) {
  const count = useReviewList().data?.length;
  if (!count) return null;
  return (
    <Link to="/ingredients" search={{ filter: "attention" }} className={buttonClass({ variant })}>
      Needs attention
      <Pill tone="peach">
        {count}
        <VisuallyHidden.Root> ingredients</VisuallyHidden.Root>
      </Pill>
    </Link>
  );
}
