import { LoginForm } from "@/components/auth/login-form";
import { APP_NAME } from "@/lib/brand";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-brand/20 via-transparent to-brand/10 pointer-events-none" />
      <div
        className="absolute -top-32 -left-32 w-96 h-96 bg-brand/30 rounded-full blur-3xl pointer-events-none"
        aria-hidden
      />
      <div
        className="absolute -bottom-32 -right-32 w-96 h-96 bg-brand/20 rounded-full blur-3xl pointer-events-none"
        aria-hidden
      />

      <div className="relative w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center shadow-lg shadow-brand/40">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="w-6 h-6 text-white"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 2L3 7l9 5 9-5-9-5zm0 7L3 14l9 5 9-5-9-5zm0 7l-9-5v3l9 5 9-5v-3l-9 5z"
                fill="currentColor"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
        </div>

        <div className="bg-bg-subtle/80 backdrop-blur-xl border border-border rounded-2xl p-8 shadow-2xl">
          <h2 className="text-xl font-medium mb-1">Entrar</h2>
          <p className="text-sm text-fg-muted mb-6">
            Acesse o painel de gestão da sua operação.
          </p>
          <LoginForm />
        </div>

        <p className="mt-6 text-xs text-center text-fg-subtle">
          Sistema interno · Acesso restrito ao time
        </p>
      </div>
    </div>
  );
}
