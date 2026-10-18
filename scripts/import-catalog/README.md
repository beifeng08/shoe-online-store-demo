# scripts/import-catalog

供应商目录导入器（决策 #16）。源：`/Users/damon233/Downloads/萨洛丁款式集合.xlsx`
（品牌供应链款式册；仅用于本机开发导入）。

职责：

1. 解析 sheet —— rows 3-31 = 29 款鞋（联盟新创 DC-10xx / 26xxx-M / JX119 系列）；
   rows 32-42 = 11 行边角料小件赠品（同名行合并为 9 款，满 $50 赠一）。
2. 解析 `xl/drawings/drawing1.xml`，把每个内嵌 PNG 按锚点 (row,col) 归到产品行，
   沿用锚点在 XML 中的文档出现顺序（未再排序）；该款第一张图即卡片封面。
3. 中文色名 → 英文 + 近似 hex 词典（SVG 兜底取真实色系）。
4. 码段（如 `女：35-40#` / `男：39-44#`）→ 整档 EU 并集（数字直读，fixture 扩至 35）。
5. cwebp 编码（>1200px 缩到 1200 宽，q80，metadata 去除）→ `public/products/<handle>/<n>.webp`。
6. 输出 `src/server/catalog/data/supplier.json`（seed/赠品的数据源，提交入库）。

重新导入（会**覆盖** public/products 与 supplier.json；价格/营销名在 seed.ts 的策展层，不受影响）：

```bash
python3 scripts/import-catalog/import.py   # 前置：pip install openpyxl；cwebp（brew install webp）
```

注意：`import.py` 不产生任何网络访问；编码尺寸/质量参数在文件顶部集中，改后需重跑并复核
仓库体积与页面观感。
