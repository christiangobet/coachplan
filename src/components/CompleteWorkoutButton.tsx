"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export default function CompleteWorkoutButton({ activityId }: { activityId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      await fetch(`/api/activities/${activityId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      router.refresh();
    });
  };

  return (
    <button className="btn-light" type="button" onClick={handleClick} disabled={isPending}>
      {isPending ? "Marking…" : "Mark as Complete"}
    </button>
  );
}
