import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['**/*.{ts,mts,cts}'],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'import-x': importX,
    },
    settings: {
      'import-x/resolver': {
        typescript: {
          project: './tsconfig.eslint.json',
        },
        node: true,
      },
    },
    rules: {
      // 同一模块的 import 必须合并（type + value 用 inline type）
      'import-x/no-duplicates': ['error', { 'prefer-inline': true }],
      // 单函数圈复杂度上限
      complexity: ['error', 10],
      // 单文件最大行数
      'max-lines': ['error', { max: 999, skipBlankLines: false, skipComments: false }],
    },
  },
);
