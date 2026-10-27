export default function ProjectLoading() {
  // Esqueleto que mimica o ProjectView final (header + 4 colunas do Kanban)
  // pra não ter o "flash de duas telas de loading" antes do conteúdo aparecer.
  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="px-6 py-3 border-b border-border bg-bg flex items-center gap-3 shrink-0">
        <div className="w-4 h-4 bg-bg-muted rounded animate-pulse" />
        <div className="w-32 h-7 bg-bg-muted rounded-lg animate-pulse" />
        <div className="h-4 w-40 bg-bg-muted rounded animate-pulse" />
        <div className="ml-auto flex items-center gap-2">
          <div className="w-32 h-8 bg-bg-muted rounded-lg animate-pulse" />
          <div className="w-28 h-8 bg-bg-muted rounded-lg animate-pulse" />
          <div className="w-24 h-8 bg-bg-muted rounded-lg animate-pulse" />
        </div>
      </div>
      {/* Colunas Kanban */}
      <div className="flex-1 overflow-hidden p-4 flex gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="w-72 shrink-0 bg-bg-subtle border border-border rounded-xl flex flex-col"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="px-3 py-2 border-b border-border flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-bg-muted animate-pulse" />
              <div className="h-3 w-24 bg-bg-muted rounded animate-pulse" />
            </div>
            <div className="p-2 space-y-2">
              {[0, 1, 2].map((j) => (
                <div
                  key={j}
                  className="bg-bg border border-border rounded-lg p-2.5 space-y-1.5"
                >
                  <div className="h-3 w-3/4 bg-bg-muted rounded animate-pulse" />
                  <div className="h-3 w-1/2 bg-bg-muted rounded animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
