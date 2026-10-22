# 脑子有泡 艺术二维码实验室

## 发布
仓库 Settings → Pages → Source 选择 Deploy from a branch，分支 main，目录 /docs，然后 Save。docs 包含已构建网页，可直接发布。

.github/workflows/pages.yml.disabled 保留备用，当前停用，避免与 main /docs 同时部署。

## 构建
Node.js 24，npm install，然后 npm run build。输出 dist；如需更新 GitHub Pages，请将构建结果同步到 docs 并保留 docs/.nojekyll。保留 assets/fonts/OFL.txt 和第三方许可。
