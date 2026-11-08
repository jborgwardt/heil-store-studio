"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { withStore } from "@/lib/store-url";
import { AppForm } from "@/components/app-form";

export default function EditAppPage() {
  return (
    <Suspense fallback={<p className="text-sm text-white/55">Loading the entry…</p>}>
      <EditApp />
    </Suspense>
  );
}

function EditApp() {
  const params = useParams<{ id: string }>();
  const store = useSearchParams().get("store") ?? "";
  const [initial, setInitial] = useState<{
    id: string;
    name: string;
    description: string;
    category: string;
    source: string;
    umbrelLogin: boolean;
    tagline: string;
    version: string;
    iconSrc: string;
  } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(withStore(`/api/apps/${params.id}`, store))
      .then((response) => response.json())
      .then((body) => {
        if (body.error) throw new Error(body.error);
        setInitial({
          id: body.id,
          name: body.name,
          description: body.description,
          category: body.category,
          source: body.source,
          umbrelLogin: body.umbrelLogin,
          tagline: body.tagline,
          version: body.version,
          iconSrc: body.iconSrc || body.icon,
        });
      })
      .catch((reason: Error) => setError(reason.message));
  }, [params.id, store]);

  if (error) return <p className="text-sm text-rose-100">{error}</p>;
  if (!initial) return <p className="text-sm text-white/55">Loading the entry…</p>;
  return <AppForm mode="edit" initial={initial} />;
}
