import { Sidebar } from "@/components/shell/sidebar";
import { QuickEntryDialog } from "@/components/log/quick-entry-dialog";
import { RewardProvider } from "@/components/reward/reward-provider";
import { appDb } from "@/services/bootstrap";
import { characterSummary, isSeeded } from "@/services/queries";
import { quickLogOptions } from "@/services/views";

export const dynamic = "force-dynamic";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const db = appDb();
  if (!isSeeded(db)) {
    return (
      <main className="mx-auto max-w-xl p-10">
        <h1 className="text-2xl font-semibold">ASCEND</h1>
        <p className="mt-3 text-muted">
          The database is empty. Run <code className="rounded bg-white/10 px-1">npm run seed</code> and reload.
        </p>
      </main>
    );
  }
  const c = characterSummary(db);
  return (
    <RewardProvider>
      <div className="flex min-h-screen">
        <Sidebar name={c.name} level={c.level.level} desktop={process.env.ASCEND_DESKTOP === "1"} />
        <main className="min-w-0 flex-1 px-8 py-6">{children}</main>
      </div>
      <QuickEntryDialog options={quickLogOptions(db)} />
    </RewardProvider>
  );
}
