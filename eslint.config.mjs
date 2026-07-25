// eslint-config-next 16 ships native flat configs on its subpath exports, so they are
// imported directly. Routing them through @eslint/eslintrc's FlatCompat.extends()
// instead crashes on ESLint 9.39+ ("Converting circular structure to JSON") because the
// legacy config validator JSON.stringify's a plugin object that self-references.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/out/**",
      "**/build/**",
      "**/public/**",
      "**/scripts/**",
      "**/*.config.js",
      "**/*.config.ts",
      "next-env.d.ts",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { 
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_"
      }],
      "react-hooks/exhaustive-deps": "warn",
      "no-console": "off",
    },
  },
];

export default eslintConfig;
