"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveClient } from "@/app/admin/crm/actions";
import { CLIENT_STATUSES, STATUS_LABEL, type CrmClient } from "@/lib/crm/types";
import { Button, inputClass, Label } from "@/components/dashboard/ui";
import { Modal } from "@/components/admin/crm/shared";
import { cn } from "@/lib/utils";

export function ClientForm({ open, onClose, client }: { open: boolean; onClose: () => void; client?: CrmClient | null }) {
  return (
    <Modal open={open} onClose={onClose} title={client ? `Edit ${client.name}` : "Add a client"}>
      {open && <Form client={client ?? null} onClose={onClose} />}
    </Modal>
  );
}

function Form({ client, onClose }: { client: CrmClient | null; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({ name: client?.name ?? "", email: client?.email ?? "", phone: client?.phone ?? "", company: client?.company ?? "", status: client?.status ?? "lead" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await saveClient({ id: client?.id, ...f });
          if (!r.ok) return setError(r.error);
          onClose();
          if (!client) router.push(`/admin/clients/${r.id}`);
          else router.refresh();
        });
      }}
    >
      <div>
        <Label htmlFor="c-name">Name</Label>
        <input id="c-name" autoFocus required className={inputClass} value={f.name} onChange={set("name")} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="c-email">Email</Label>
          <input id="c-email" type="email" className={inputClass} value={f.email} onChange={set("email")} />
        </div>
        <div>
          <Label htmlFor="c-phone">Phone</Label>
          <input id="c-phone" type="tel" className={inputClass} value={f.phone} onChange={set("phone")} />
        </div>
        <div>
          <Label htmlFor="c-company">Company</Label>
          <input id="c-company" className={inputClass} value={f.company} onChange={set("company")} />
        </div>
        <div>
          <Label htmlFor="c-status">Status</Label>
          <select id="c-status" className={cn(inputClass, "[&>option]:bg-[#26282a]")} value={f.status} onChange={set("status")}>
            {CLIENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="text-[13px] text-bad">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : client ? "Save" : "Add client"}
        </Button>
      </div>
    </form>
  );
}
