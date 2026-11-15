"use client";
import { useRouter } from "next/navigation";
import { ActivityForm, type ActivityDraft, type FormOptions } from "@/components/log/activity-form";

export function NewActivity({ options, initial }: { options: FormOptions; initial: ActivityDraft }) {
  const router = useRouter();
  return <ActivityForm options={options} initial={initial} onSaved={(id) => router.push(id ? `/activities/${id}` : "/activities")} />;
}
