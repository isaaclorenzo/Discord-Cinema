export function Background() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(76,29,149,0.22),transparent_60%)]" />
      <div className="absolute -left-40 -top-40 size-[42rem] rounded-full bg-violet-600/20 blur-[110px] animate-drift-a" />
      <div className="absolute -bottom-52 -right-32 size-[38rem] rounded-full bg-cyan-500/15 blur-[110px] animate-drift-b" />
      <div className="absolute left-1/3 top-1/2 size-[26rem] rounded-full bg-amber-400/[0.07] blur-[120px] animate-drift-c" />
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
        }}
      />
    </div>
  )
}
