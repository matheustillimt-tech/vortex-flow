import type { Metadata } from "next";
import Script from "next/script";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme/theme-provider";
import "./globals.css";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Gestão de projetos, tarefas e ferramentas da equipe",
  icons: { icon: "/favicon.svg" }
};

// Evita flash de tema errado aplicando a classe antes do React montar.
const THEME_SCRIPT = `
(function() {
  try {
    var t = localStorage.getItem('vortex-theme');
    if (!t) t = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    if (t === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_SCRIPT}
        </Script>
      </head>
      <body>
        <ThemeProvider>
          {children}
          <Toaster
            position="top-right"
            theme="system"
            toastOptions={{
              style: {
                background: "rgb(var(--bg-subtle))",
                border: "1px solid rgb(var(--border))",
                color: "rgb(var(--fg))"
              }
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
