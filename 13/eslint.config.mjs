import js from '@eslint/js';
export default [js.configs.recommended,{files:['**/*.mjs'],languageOptions:{ecmaVersion:2023,sourceType:'module',globals:{process:'readonly',Buffer:'readonly',fetch:'readonly',AbortSignal:'readonly',URL:'readonly',performance:'readonly',console:'readonly',setTimeout:'readonly'}}}];
