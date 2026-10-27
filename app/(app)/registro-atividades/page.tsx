import { redirect } from "next/navigation";

/** Movido para uma aba dentro de Configurações. Mantido para não quebrar links salvos. */
export default function RegistroAtividadesRedirect() {
  redirect("/configuracoes");
}
