import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0d1117",
          raised: "#161b22",
          overlay: "#1c2330",
        },
        line: "#252c3a",
        accent: {
          DEFAULT: "#1877f2",
          soft: "#3b82f6",
        },
      },
    },
  },
  plugins: [],
};
export default config;
