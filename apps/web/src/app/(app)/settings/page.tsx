import { NotificationPrefsSchema } from "@billsplit/contracts";
import { notFound } from "next/navigation";
import { serverApi } from "@/lib/server-api";
import { AccountSettings } from "./account-settings";
import { NotificationSettings } from "./notification-settings";

export const metadata = { title: "Settings · BillSplit" };

export default async function SettingsPage() {
  const prefs = await serverApi("/me/notifications", NotificationPrefsSchema);
  if (!prefs) notFound();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <NotificationSettings initial={prefs} />
      <AccountSettings />
    </div>
  );
}
