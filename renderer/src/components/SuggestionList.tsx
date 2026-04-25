import type { Suggestion } from "@flowos/shared";
import { motion } from "framer-motion";

interface SuggestionListProps {
  heading: string;
  items: Suggestion[];
}

export function SuggestionList({ heading, items }: SuggestionListProps) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-[0_20px_60px_rgba(15,23,42,0.35)]">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.24em] text-white/60">
          {heading}
        </h2>
        <span className="text-[10px] uppercase tracking-[0.22em] text-orange-300/80">
          Live
        </span>
      </div>

      <div className="space-y-3">
        {items.map((item, index) => (
          <motion.button
            key={item.id}
            type="button"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.22, delay: index * 0.05 }}
            className="block w-full rounded-2xl border border-white/10 bg-slate-950/50 p-3 text-left transition hover:border-orange-400/40 hover:bg-slate-950/80"
          >
            <div className="text-sm font-medium text-white">{item.title}</div>
            <div className="mt-1 text-xs leading-5 text-white/65">{item.description}</div>
            <div className="mt-3 flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-white/40">
              <span>{item.source}</span>
              <span>{Math.round(item.confidence * 100)}%</span>
            </div>
          </motion.button>
        ))}
      </div>
    </section>
  );
}

