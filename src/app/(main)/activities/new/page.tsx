import { NewActivity } from "@/components/activities/new-activity";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/views/bits";
import { DIFFICULTIES, type Difficulty } from "@/domain/types";
import { requestTime } from "@/lib/clock";
import { appDb } from "@/services/bootstrap";
import { formOptions } from "@/services/views";

export const dynamic = "force-dynamic";

export default async function NewActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const p = await searchParams;
  const options = formOptions(appDb());
  let skills: { skillId: string; weight: number }[] = [{ skillId: options.skills[0]!.id, weight: 100 }];
  try {
    if (p.skills) skills = JSON.parse(p.skills);
  } catch {
    /* keep the default */
  }
  const duration = Number(p.duration ?? 30);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Log an activity" subtitle="For anything the quick logger can't capture: split skills, backdating, measured results." />
      <Card>
        <CardBody className="pt-5">
          <NewActivity
            options={options}
            initial={{
              name: p.name ?? "",
              startAt: requestTime() - duration * 60_000,
              durationMin: duration,
              activityTypeId: p.type ?? "practice",
              difficulty: DIFFICULTIES.includes(p.difficulty as Difficulty) ? (p.difficulty as Difficulty) : "normal",
              skills,
              notes: p.notes ?? "",
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
