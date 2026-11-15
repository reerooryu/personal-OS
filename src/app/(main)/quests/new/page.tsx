import { QuestForm } from "@/components/quests/quest-form";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/views/bits";
import { appDb } from "@/services/bootstrap";
import { currentFormula } from "@/services/context";
import { formOptions } from "@/services/views";

export const dynamic = "force-dynamic";

export default function NewQuestPage() {
  const db = appDb();
  const o = formOptions(db);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New quest" subtitle="Big goals are yours to define. Progress then comes automatically from what you log." />
      <Card>
        <CardBody className="pt-5">
          <QuestForm skills={o.skills} attributes={o.attributes} measurementTypes={o.measurementTypes} defaults={currentFormula(db).params.questRewardDefaults} />
        </CardBody>
      </Card>
    </div>
  );
}
