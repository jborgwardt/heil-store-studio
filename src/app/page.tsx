import { Suspense } from "react";
import { StoreHome } from "@/components/store-home";

export default function HomePage() {
  return (
    <Suspense fallback={<p className="text-sm text-white/55">Loading the store…</p>}>
      <StoreHome />
    </Suspense>
  );
}
