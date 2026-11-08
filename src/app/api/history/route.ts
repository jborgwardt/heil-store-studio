import { storeHistory } from "@/lib/store";
import { fail, inStore, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return await inStore(request, async () => {
      return json({ history: await storeHistory() });
    });
  } catch (error) {
    return fail(error);
  }
}
