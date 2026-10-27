"use client";

import { NotificationBell } from "@/components/notifications/notification-bell";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export function Topbar() {
  return (
    <header className="h-[var(--topbar-h)] border-b border-border bg-bg/80 backdrop-blur flex items-center px-4 sticky top-0 z-30">
      <div className="flex-1" />
      <div className="flex items-center gap-0.5">
        <ThemeToggle />
        <NotificationBell />
      </div>
    </header>
  );
}
