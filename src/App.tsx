export default function App() {
  return (
    <div className="relative grid h-full place-items-center overflow-hidden">
      <div className="pointer-events-none absolute -left-32 -top-32 size-[38rem] rounded-full bg-violet-600/25 blur-3xl animate-drift-a" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 size-[34rem] rounded-full bg-cyan-500/20 blur-3xl animate-drift-b" />
      <main className="glass relative max-w-md rounded-[var(--radius-glass)] p-8 text-center">
        <h1 className="text-gradient text-3xl font-semibold tracking-tight">Glasshouse</h1>
        <p className="mt-3 text-sm text-muted">
          Harness aislada para probar modelos en los que no confías. En construcción.
        </p>
      </main>
    </div>
  )
}
