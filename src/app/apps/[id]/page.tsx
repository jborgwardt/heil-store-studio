import { Suspense } from "react";
import { AppDetail } from "@/components/app-detail";

export default async function AppPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<p className="text-sm text-white/55">Loading {id}…</p>}>
      <AppDetail id={id} />
    </Suspense>
  );
}
