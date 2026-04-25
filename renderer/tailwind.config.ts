import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        shell: "#0f172a",
        panel: "#111827",
        accent: "#f97316",
        ink: "#e5e7eb"
      }
    }
  },
  plugins: []
} satisfies Config;

