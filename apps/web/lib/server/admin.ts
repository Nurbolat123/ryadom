import { getSession } from "./session";

/** Модератор: роль admin выдаётся командой `pnpm admin:grant <телефон>`. */
export const getAdmin = async () => {
  const session = await getSession();
  return session?.user?.role === "admin" ? session.user : null;
};
