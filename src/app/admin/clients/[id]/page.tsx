import { notFound } from "next/navigation";
import { getClientDetail } from "@/lib/crm/data";
import { appUrl } from "@/lib/crm/email";
import { zoomReady } from "@/lib/crm/zoom";
import { ClientDetail } from "@/components/admin/crm/ClientDetail";

export const dynamic = "force-dynamic";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const detail = await getClientDetail(id);
  if (!detail) notFound();
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-8">
      <ClientDetail {...detail} zoom={zoomReady()} appUrl={appUrl()} />
    </div>
  );
}
