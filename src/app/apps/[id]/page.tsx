import { AppDetail } from "@/components/app-detail";

export default async function AppPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppDetail id={id} />;
}
