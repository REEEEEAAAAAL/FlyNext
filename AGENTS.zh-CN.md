# FlyNext 工程规范

FlyNext 是基于 Next.js 的旅行预订作品集应用。用户界面为英语，支持浅色和深色主题。

## 技术栈

- Node.js 24、Next.js 15.5.28 App Router、React 19.0.9、TypeScript 5 strict、Tailwind CSS 4。
- PostgreSQL 与 Prisma 6.3.1。
- Vitest 用于单元和集成测试，Playwright 用于浏览器端到端测试。
- 依赖版本以锁文件为准；未经明确要求，不升级或替换依赖。

## 目录约定

- `app/`：页面、共享组件、布局和错误边界。
- `app/api/`：HTTP Route Handlers。
- `lib/api/`：请求校验、鉴权、授权、限流、幂等和错误处理。
- `lib/reservations.ts`：预订生命周期和跨领域协调。
- `lib/afs/`：内置航班供应商及其预订账本。
- `prisma/`：数据模型、迁移和种子数据。
- `types/`：共享 TypeScript 契约。
- `tests/`、`e2e/`：单元/集成测试和浏览器工作流。
- `scripts/`：开发、验证和维护命令。
- `docs/`：公开开发/部署说明及合成数据截图。
- `afs/`：固定版本的独立供应商覆盖实现；仅修改该供应商时阅读 `afs/README.md`。

## 常用命令

- `npm ci`：按锁文件安装依赖并生成 Prisma Client，不应用迁移。
- `npm run dev`：启动本地开发服务器。
- `npm run typecheck`：检查应用和测试 TypeScript 类型。
- `npm run lint`：运行 ESLint。
- `npm test`：运行数据库无关单元测试。
- `npm run build:server`：编译独立服务端 TypeScript。
- `npm run build`：生成 Next.js 生产构建。
- `npm run test:db:verify`、`npm run test:integration`、`npm run test:e2e`：核验数据库目标后，按顺序运行集成和浏览器测试。
- `npm run prisma:migrate` 和 `npm run seed:reference` 会写入数据库，运行前确认目标。
- `npm run seed` 与 `npm run seed:prod` 是清理型演示种子，不得用于保留真实数据的数据库。

## 实现约定

- 保持严格类型；优先复用现有模块、领域类型和响应契约。
- 不用 `any`、类型断言或关闭检查来掩盖不确定类型。
- Route Handlers 使用 `withRoute` 和 `ApiError`。
- 延续现有 HTTP 状态码、响应包装和 JSON 数值类型。
- 在服务端执行鉴权和资源所有权检查，不能只依赖界面隐藏控件。
- 校验外部输入后再执行数据库写入、上传或供应商调用。
- 不向客户端返回数据库异常、连接信息或内部诊断。
- 保留现有错误处理、限流和幂等边界，不为简化实现移除保护。
- 组件与领域逻辑尽量沿用当前目录和职责，不引入重复实现。
- 注释应简洁、专业、自然；不要在注释中使用 Markdown、表情或装饰字符。

## 安全与测试

- 不提交或输出环境文件、真实凭据、完整连接串、令牌、备份或个人数据。
- 示例配置只能使用无效占位值；不要复制本地环境文件作为示例。
- 单元测试不得隐式读取本地环境文件或连接数据库。
- 集成和 E2E 测试只能使用专用、隔离且经安全运行器核验的测试数据库。
- 不绕过数据库安全运行器，不对开发或生产数据运行测试夹具。
- 测试会写入、迁移或清理数据库时，先确认目标及操作影响。
- 审阅 Prisma 迁移；迁移只对明确授权的目标执行。
- 构建步骤不得隐式迁移、重置数据库或填充种子数据。

## 核心业务约束

- 酒店入住和退房使用 UTC 日历日期；保持旧数据兼容及库存并发保护。
- 预订写入保留事务和幂等键；取消恢复库存应保持一致且不可重复扣加。
- 公开酒店和房型响应不得包含客人预订记录。
- 房主数据必须校验当前用户身份及资源所有权。
- 一个行程最多包含一个航班预订和一个酒店预订。
- DEMO 结账不处理真实资金，不收集真实银行卡或护照信息。

## 文档与交付

先读 `README.md` 了解架构和安装。按需阅读 `docs/DEVELOPMENT.md` 中的测试与 CI、`docs/DEPLOYMENT.md` 中的托管与迁移，或 `docs/DOCKER.md` 中的本地容器操作。应用包含八条迁移，最新为 `20261020091000_external_recovery`；独立 AFS 使用自己的迁移历史。
生产环境使用内置 AFS；可选远程供应商操作应与生产操作分开。不得对已有机票数据库切换供应商。
维护改动从最新 `origin/main` 创建新分支；Squash Merge 后的 Ahead/Behind 差异不需修复。
公开说明应简洁、可复现，不加入内部交接、私人端点或生产运维记录。
