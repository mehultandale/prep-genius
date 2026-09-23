'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, auth, kits, setToken, getToken } from '@/lib/api';
import type { KitDocument } from '@/types/kit';

export default function Dashboard() {
  const router = useRouter();
  const [kitsList, setKitsList] = useState<KitDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');

  // creation form
  const [jd, setJd] = useState('');
  const [companyUrl, setCompanyUrl] = useState('');
  const [days, setDays] = useState(5);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [batchInfo, setBatchInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push('/login');
      return;
    }
    auth
      .me()
      .then((res) => setEmail(res.user.email))
      .catch(() => router.push('/login'));
    loadKits();
  }, [router]);

  async function loadKits() {
    try {
      const res = await kits.list();
      setKitsList(res.kits ?? []);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    setBatchInfo(null);
    try {
      await kits.create(jd, companyUrl, days);
      setJd('');
      setCompanyUrl('');
      await loadKits();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create kit');
    } finally {
      setCreating(false);
    }
  }

  async function handleBatchFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBatchInfo(null);
    try {
      const text = await file.text();
      const cases = JSON.parse(text);
      if (!Array.isArray(cases)) throw new Error('File must contain a JSON array of {jd, company_url, days}');
      const res = await kits.createBatch(cases);
      setBatchInfo(`Batch accepted: ${res.kits.length} kits generating (batch ${res.batchId.slice(-6)}).`);
      await loadKits();
    } catch (err) {
      setBatchInfo(`Batch upload failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  async function handleLogout() {
    await auth.logout().catch(() => {});
    setToken(null);
    router.push('/login');
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Prep Genius</h1>
          <p className="text-sm text-slate-500">Signed in as {email}</p>
        </div>
        <button onClick={handleLogout} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">
          Sign out
        </button>
      </header>

      <section className="mb-10 grid gap-6 md:grid-cols-2">
        <form onSubmit={handleCreate} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold">New kit</h2>
          <label className="mb-1 block text-sm font-medium">Job description</label>
          <textarea
            required
            minLength={20}
            rows={6}
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            className="mb-3 w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-indigo-500 focus:outline-none"
            placeholder="Paste the full job description here…"
          />
          <label className="mb-1 block text-sm font-medium">Company website</label>
          <input
            required
            type="url"
            value={companyUrl}
            onChange={(e) => setCompanyUrl(e.target.value)}
            className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            placeholder="https://company.example"
          />
          <label className="mb-1 block text-sm font-medium">Days until interview</label>
          <input
            required
            type="number"
            min={1}
            max={60}
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10) || 1)}
            className="mb-4 w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
          {createError && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{createError}</p>}
          <button
            type="submit"
            disabled={creating}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {creating ? 'Starting…' : 'Generate kit'}
          </button>
        </form>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-2 font-semibold">Prepare for multiple roles</h2>
          <p className="mb-4 text-sm text-slate-500">
            Upload a JSON file of description-and-company pairs:
            <code className="mt-2 block rounded bg-slate-100 p-2 text-xs">
              [{'{'} "jd": "…", "company_url": "…", "days": 5 {'}'}]
            </code>
          </p>
          <input
            type="file"
            accept=".json,application/json"
            onChange={handleBatchFile}
            className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-indigo-700 hover:file:bg-indigo-100"
          />
          {batchInfo && <p className="mt-3 rounded bg-slate-100 px-3 py-2 text-sm">{batchInfo}</p>}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Your kits</h2>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : kitsList.length === 0 ? (
          <p className="text-sm text-slate-500">No kits yet — create your first one above.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {kitsList.map((k) => (
              <li key={k._id}>
                <Link
                  href={`/kits/${k._id}`}
                  className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-300 hover:shadow"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{k.title}</span>
                    <StatusBadge status={k.status} />
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {k.days} days · {k.kit?.role?.title || k.kit?.source?.company || '—'}
                  </p>
                  <p className="text-xs text-slate-400">{new Date(k.createdAt).toLocaleString()}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function StatusBadge({ status }: { status: KitDocument['status'] }) {
  const styles: Record<KitDocument['status'], string> = {
    generating: 'bg-amber-100 text-amber-800',
    ready: 'bg-emerald-100 text-emerald-800',
    failed: 'bg-red-100 text-red-800',
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${styles[status]}`}>
      {status === 'generating' ? 'Generating…' : status === 'ready' ? 'Ready' : 'Failed'}
    </span>
  );
}
