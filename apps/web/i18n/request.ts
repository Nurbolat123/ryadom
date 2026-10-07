import { getRequestConfig } from "next-intl/server";
import { requestLocale } from "@/lib/server/locale";

/** Язык: выбранный в приложении (cookie «locale»), иначе из настроек браузера. */
export default getRequestConfig(async () => {
  const locale = await requestLocale();
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
