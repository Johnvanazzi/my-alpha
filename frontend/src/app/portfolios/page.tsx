"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { Button, Card, Empty, ErrorBox, Field, Input, PageHeader, Spinner } from "@/components/ui";
import { api, fetcher } from "@/lib/api";
import { pct } from "@/lib/format";
import type { Portfolio } from "@/lib/types";

export default function PortfoliosPage() {
  const router = useRouter();
  const { data, error, isLoading, mutate } = useSWR<Portfolio[]>("/portfolios", fetcher);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<unknown>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const p = await api.createPortfolio({ name: name.trim(), description: description.trim() || undefined });
      router.push(`/portfolios/${p.id}`);
    } catch (err) {
      setFormError(err);
      setSaving(false);
    }
  };

  const remove = async (p: Portfolio) => {
    if (!confirm(`Delete portfolio "${p.name}"? This cannot be undone.`)) return;
    await api.deletePortfolio(p.id);
    mutate();
  };

  return (
    <>
      <PageHeader title="Portfolios" subtitle="Each portfolio is a set of tickers with target weights." />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="New portfolio">
          <form onSubmit={create} className="flex flex-col gap-3">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Long-term core" required maxLength={120} />
            </Field>
            <Field label="Description (optional)">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
            </Field>
            <ErrorBox error={formError} />
            <Button variant="primary" disabled={!name.trim() || saving}>
              {saving ? "Creating…" : "Create and add holdings"}
            </Button>
          </form>
        </Card>

        <Card title="All portfolios" className="lg:col-span-2">
          {isLoading && <Spinner />}
          <ErrorBox error={error} />
          {data?.length === 0 && <Empty>No portfolios yet.</Empty>}
          <div className="grid gap-3 sm:grid-cols-2">
            {data?.map((p) => (
              <div key={p.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/portfolios/${p.id}`} className="font-semibold text-white hover:text-sky-300">
                    {p.name}
                  </Link>
                  <Button size="sm" variant="danger" onClick={() => remove(p)}>
                    Delete
                  </Button>
                </div>
                {p.description && <p className="mt-1 text-sm text-slate-400">{p.description}</p>}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {p.holdings.slice(0, 8).map((h) => (
                    <span key={h.id} className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-300">
                      {h.ticker} {pct(h.weight, 0)}
                    </span>
                  ))}
                  {p.holdings.length > 8 && <span className="text-xs text-slate-500">+{p.holdings.length - 8} more</span>}
                  {p.holdings.length === 0 && <span className="text-xs text-slate-500">No holdings</span>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
