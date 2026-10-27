import { PRIORITY_COLOR, PRIORITY_LABEL, STATUS_COLOR, STATUS_LABEL, type TaskPriority, type TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PriorityBadge({ value, className }: { value: TaskPriority; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium",
        className
      )}
      style={{
        backgroundColor: PRIORITY_COLOR[value] + "20",
        color: PRIORITY_COLOR[value]
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: PRIORITY_COLOR[value] }}
      />
      {PRIORITY_LABEL[value]}
    </span>
  );
}

export function StatusBadge({ value, className }: { value: TaskStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium",
        className
      )}
      style={{
        backgroundColor: STATUS_COLOR[value] + "20",
        color: STATUS_COLOR[value]
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: STATUS_COLOR[value] }}
      />
      {STATUS_LABEL[value]}
    </span>
  );
}
