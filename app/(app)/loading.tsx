export default function AppLoading() {
  return (
    <div className="flex items-center justify-center h-[60vh]">
      <div className="flex items-center gap-3 text-fg-muted text-sm">
        <span className="w-4 h-4 rounded-full border-2 border-brand/30 border-t-brand animate-spin" />
        Carregando...
      </div>
    </div>
  );
}
