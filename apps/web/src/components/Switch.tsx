// Schalter (an/aus) für Einstellungen; ganze Zeile ist Tippfläche.
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="tap w-full flex items-center justify-between gap-3 py-1 text-left disabled:opacity-40"
    >
      <span className="text-sm">{label}</span>
      <span aria-hidden className={`relative inline-block w-11 h-6 rounded-full transition-colors ${on ? "bg-brass-400" : "bg-navy-700"}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? "left-5" : "left-0.5"}`} />
      </span>
    </button>
  );
}
