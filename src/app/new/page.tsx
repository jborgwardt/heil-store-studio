import { Suspense } from "react";
import { AppForm } from "@/components/app-form";

export default function NewAppPage() {
  return (
    <Suspense fallback={null}>
      <AppForm mode="create" />
    </Suspense>
  );
}
