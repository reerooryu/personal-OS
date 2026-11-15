import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { SkillChoice } from "@/components/imports/import-review";
import { AddButtons, HomeworkRow, TestRow, type HomeworkItem, type LessonChoices, type TestItem } from "./schoolwork";

/** Overview card: overdue and next three days of homework, tests this week, results to enter. */
export function DueSoon({
  data,
  now,
  skills,
  lessons,
}: {
  data: { overdue: HomeworkItem[]; upcoming: HomeworkItem[]; tests: TestItem[]; results: TestItem[] };
  now: number;
  skills: SkillChoice[];
  lessons: LessonChoices;
}) {
  const homework = [...data.overdue, ...data.upcoming];
  const tests = [...data.results, ...data.tests.filter((x) => !data.results.some((r) => r.id === x.id))];
  return (
    <Card className="mb-5">
      <CardHeader
        className={homework.length || tests.length ? undefined : "pb-4"}
        title="Homework and tests"
        subtitle={
          <Link href="/homework" className="hover:text-ink">
            {homework.length ? `${homework.length} due in the next three days${data.overdue.length ? `, ${data.overdue.length} overdue` : ""}` : "Nothing due in the next three days"} →
          </Link>
        }
        action={<AddButtons skills={skills} lessons={lessons} />}
      />
      {(homework.length > 0 || tests.length > 0) && (
        <CardBody className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {tests.map((x) => (
            <TestRow key={x.id} x={x} now={now} skills={skills} lessons={lessons} />
          ))}
          {homework.map((h) => (
            <HomeworkRow key={h.id} h={h} now={now} skills={skills} lessons={lessons} compact />
          ))}
        </CardBody>
      )}
    </Card>
  );
}
