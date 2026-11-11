import { Alert } from "@/components/ui/alert";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getServerSession } from "@/lib/session";

export const metadata = { title: "Dashboard · BillSplit" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string }>;
}) {
  const [{ verified }, session] = await Promise.all([searchParams, getServerSession()]);
  const user = session!.user;

  return (
    <div className="flex flex-col gap-6">
      {verified ? <Alert tone="success">Email verified. Welcome aboard.</Alert> : null}
      <Card className="flex flex-col gap-2">
        <CardTitle>Hi {user.name.split(" ")[0]}</CardTitle>
        <CardDescription>
          Signed in as {user.email}. Groups, receipts and balances arrive in the next steps.
        </CardDescription>
      </Card>
    </div>
  );
}
