import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ConectorView } from "@/components/conector/conector-view";

/** Página pessoal: cada um gera o próprio token do conector do Claude. */
export default async function ConectorPage() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <ConectorView />;
}
