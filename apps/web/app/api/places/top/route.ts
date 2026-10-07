import { fail } from "@/lib/server/http";
import { topOfWeek } from "@/lib/server/places";

export const dynamic = "force-dynamic";

/** «Топ мест недели» — только порядок мест, без чисел. */
export async function GET(req: Request) {
  const city = new URL(req.url).searchParams.get("city") ?? "almaty";
  if (city !== "almaty" && city !== "astana") return fail(400, "bad_request");
  return Response.json({ city, venues: await topOfWeek(city) });
}
