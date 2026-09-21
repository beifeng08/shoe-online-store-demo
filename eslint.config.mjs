import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'backend/**',
    '.uv-cache/**',
  ]),
  {
    rules: {
      // `const { id, ...rest } = row` 是 TS 里「摘掉一个键」的惯用写法，rest 的兄弟变量本就
      // 有意不用；不开这个选项只会逼出 `void id` 之类的凑数行。同时消掉 product-row.test.ts
      // 既有的两条 no-unused-vars 警告。
      '@typescript-eslint/no-unused-vars': ['warn', { ignoreRestSiblings: true }],
    },
  },
])

export default eslintConfig
