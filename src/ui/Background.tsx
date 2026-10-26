export function Background() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-ink-950" aria-hidden>
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-[radial-gradient(ellipse_at_bottom,rgba(16,120,132,0.32),transparent_68%)]" />
      <div className="absolute -bottom-40 left-1/2 h-80 w-[70rem] -translate-x-1/2 rounded-full bg-teal-500/10 blur-[120px]" />
    </div>
  )
}
