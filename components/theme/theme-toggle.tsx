"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "./theme-provider";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      onClick={toggle}
      className="p-1.5 rounded-lg hover:bg-bg-muted text-fg-muted hover:text-fg transition"
      title={isDark ? "Tema claro" : "Tema escuro"}
      aria-label="Alternar tema"
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
