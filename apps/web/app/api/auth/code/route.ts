import { normalizePhone } from "@ryadom/shared";
import { clientIp } from "@/lib/rate-limit";
import { fail, readJson } from "@/lib/server/http";
import { requestLoginCode } from "@/lib/server/otp";

export const dynamic = "force-dynamic";

/** Шаг 1 входа: отправить код на телефон. */
export async function POST(req: Request) {
  const body = (await readJson(req)) as { phone?: unknown } | null;
  const phone = typeof body?.phone === "string" ? normalizePhone(body.phone) : null;
  if (!phone) return fail(400, "invalid_phone");

  const res = await requestLoginCode(phone, clientIp(req));
  if (!res.ok) {
    return fail(429, res.error, { retryAfterSec: res.retryAfterSec });
  }
  return Response.json({
    ok: true,
    phone,
    resendAfterSec: res.resendAfterSec,
    devCode: res.devCode,
  });
}
