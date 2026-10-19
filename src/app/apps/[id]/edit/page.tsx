"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppForm } from "@/components/app-form";

export default function EditAppPage() {
  const params = useParams<{ id: string }>();
  const [initial, setInitial] = useState<{
    id: string;
    name: string;
    description: string;
    category: string;
    source: string;
    umbrelLogin: boolean;
    tagline: string;
    version: string;
  } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/apps/${params.id}`)
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
        });
      })
      .catch((reason: Error) => setError(reason.message));
  }, [params.id]);

  if (error) return <p className="text-sm text-rose-100">{error}</p>;
  if (!initial) return <p className="text-sm text-white/55">Loading the entry…</p>;
  return <AppForm mode="edit" initial={initial} />;
}
