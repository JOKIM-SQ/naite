import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mjs', '**/*.ts'],
    languageOptions: {
      globals: {
        process: 'readonly', console: 'readonly', Buffer: 'readonly',
        URL: 'readonly', fetch: 'readonly', Response: 'readonly',
        ReadableStream: 'readonly', AbortController: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly'
      }
    }
  }
);
