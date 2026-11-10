import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**', '.npm-cache/**', '.artifacts/**'] },
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }], '@typescript-eslint/no-empty-function': 'off' } },
);
