import { defineConfig, globalIgnores } from "eslint/config";
import ts from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
export default defineConfig([
  ...ts.configs.recommended,
  {
    files: ["**/*.tsx"],
    plugins: { "react-hooks": hooks },
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      ...hooks.configs.recommended.rules,
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  { rules: { "@typescript-eslint/no-explicit-any": "off" } },
  globalIgnores([".next/**", "node_modules/**", "next-env.d.ts"]),
]);
