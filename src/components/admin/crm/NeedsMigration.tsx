import { EmptyState, Panel } from "@/components/dashboard/ui";

export function NeedsMigration() {
  return (
    <Panel>
      <EmptyState title="Run the CRM migration">
        Run <code className="break-all font-mono text-[12px]">supabase/migrations/20261119000000_admin_crm.sql</code> in the Supabase SQL editor, then reload this page.
      </EmptyState>
    </Panel>
  );
}
