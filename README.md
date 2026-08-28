# 润滑油配方计算器

> LUBEMATER · FORMULATION LAB — 润滑剂调和粘度理论计算

单页配方计算器，用于估算润滑油调和后的 40℃ 运动粘度（KV40）、ISO VG 等级与配方成本。

## 功能

- **配比 → 粘度**：输入各组分的运动粘度与比例，计算调和粘度、ISO VG 等级与成本
- **目标粘度 → 配比**：给定目标粘度，反推三组分比例
- **最低成本优化**：在比例与类别约束下求最低成本配方
- **方案管理**：本地保存配方，CSV/JSON 导入导出，多方案对比（含成本节省）

## 模型说明

采用 ASTM D7152 的 Refutas 双对数变换 `log10(log10(ν + 0.8))`，组分按体积分数加权平均后反算调和粘度。结果仅用于配方设计参考，实际粘度以实验室实测为准。

## 技术栈

- React + TypeScript
- Vite
- Vitest（单元测试）+ Playwright（E2E 测试）

## 快速开始

```bash
npm install
npm run dev        # 启动开发服务器
npm run build      # 生产构建
npm test           # 单元测试
npm run test:e2e   # E2E 测试
```

## 目录结构

```
src/calculation/   粘度模型、调和/反算/优化、成本、ISO VG 分类
src/recipe/        配方存储、导入导出、方案对比
src/               界面组件
e2e/               Playwright 端到端测试
```
