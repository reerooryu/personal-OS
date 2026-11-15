import { QuickWindow } from "@/components/log/quick-window";
import { appDb } from "@/services/bootstrap";
import { quickLogOptions } from "@/services/views";

export const dynamic = "force-dynamic";

/** The small always-on-top window opened by the global shortcut in the desktop app. */
export default function QuickPage() {
  return <QuickWindow options={quickLogOptions(appDb())} />;
}
