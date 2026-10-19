import { storeHistory } from "@/lib/store";
import { fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json({ history: await storeHistory() });
  } catch (error) {
    return fail(error);
  }
}
