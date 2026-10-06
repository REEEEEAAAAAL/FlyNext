# FlyNext

FlyNext 是一个全栈旅行预订应用。它通过 Advanced Flights System（AFS）搜索并预订航班，
预订酒店与房型，把两者组合成一份行程，完成结账，并生成可下载的 PDF 发票。

航班相关操作全部基于 AFS 契约完成，该契约有两个可互换的服务商实现：一个是默认启用的
**内置服务商**，在应用进程内直接应答，无需任何外部服务与 API Key；另一个是 **自建 AFS
容器**，由上游项目源码构建，通过 HTTP 提供同一套契约。[`lib/afs/config.ts`](./lib/afs/config.ts)
按每次调用决定使用哪一个，详见[航班服务商](#flight-provider)。

整个代码库 —— 前端与后端 —— 均为 TypeScript。HTTP API 配有一套针对真实 PostgreSQL
数据库运行的集成测试，因为被测行为只存在于那里。

---

## 目录

- [功能](#features)
- [技术栈](#tech-stack)
- [架构](#architecture)
- [设计决策](#design-decisions)
- [快速开始](#getting-started)
- [环境变量](#environment-variables)
- [命令一览](#scripts)
- [测试与验证](#testing-and-verification)
- [API 约定](#api-conventions)
- [航班服务商](#flight-provider)
- [Docker](#docker)
- [部署](#deployment)
- [目录结构](#layout)
- [许可](#license)

---

<a id="features"></a>

## 功能

| 模块 | 能力 |
| --- | --- |
| 航班 | 单程与往返搜索、下单出票、查询订单、取消退票 |
| 酒店 | 搜索酒店、创建与编辑酒店、管理房型与按晚库存 |
| 行程 | 组合航班与酒店预订、查看实时总价、单独取消某一项 |
| 结账 | 把草稿行程确认为订单，并下载 PDF 发票 |
| 账号 | 注册、JWT 登录与刷新、个人资料与头像管理 |
| 通知 | 按用户的通知列表与未读角标 |
| 房主 | 房主专属的酒店列表视图，以及按房型的可用量与预订图表 |

---

<a id="tech-stack"></a>

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Next.js 15（App Router） |
| 语言 | TypeScript 5，`strict: true` |
| 数据库 | PostgreSQL |
| ORM | Prisma 6 |
| 认证 | JWT 访问令牌 + `httpOnly` 刷新 Cookie（`jsonwebtoken`、`bcryptjs`） |
| 样式 | Tailwind CSS 4 |
| 图表 | `chart.js`（通过 `react-chartjs-2`） |
| PDF | `pdf-lib` |
| 图片存储 | Cloudinary（`cloudinary`） |
| 航班服务 | AFS（`axios`）—— 自建容器，或 `lib/afs/` 中的内置进程内实现 |
| 测试 | Vitest |

图片**不**存放在服务器上。酒店 Logo、房型图集与头像都会流式上传到 Cloudinary，
数据库里保存的是它返回的绝对地址 `https://res.cloudinary.com/...`。Serverless 平台
给每次函数调用的磁盘是只读且随实例销毁的，因此本地根本不存在一个能让上传文件存活下来的
目录。

---

<a id="architecture"></a>

## 架构

### 请求链路

每个 HTTP 路由都是 `app/api/` 下一个带类型的 `route.ts` 处理器。它们统一包在
[`lib/api/handler.ts`](./lib/api/handler.ts) 的 `withRoute` 中 —— 那是唯一的错误边界，
负责把抛出的 `ApiError` 转成浏览器客户端期望的 JSON 信封。因此处理器本身从不拼装失败响应。

服务端基础设施集中在 `lib/api/`：

| 模块 | 职责 |
| --- | --- |
| `errors.ts` | `ApiError` 错误体系与状态码构造函数 |
| `response.ts` | JSON 信封辅助函数（`{ error }`、`{ message }`、`Set-Cookie`） |
| `validation.ts` | 输入解析与校验 |
| `auth.ts` | `Request` → `AuthContext` 的解析 |
| `handler.ts` | 错误边界（`withRoute`） |
| `rate-limit.ts` | 进程内的按客户端请求配额 |
| `events.ts` | 结构化、可检索的事件日志 |
| `notify.ts` | 不允许让请求失败的通知写入 |
| `upload.ts` | 带校验的图片上传，存到 Cloudinary |

需要被多个路由复用的业务逻辑紧邻它们存放：`lib/reservations.ts` 负责预订生命周期，
`lib/afs-client.ts` 负责航班服务商客户端。

### 数据模型

[`prisma/schema.prisma`](./prisma/schema.prisma) 定义了领域模型：`User`、`Hotel`、
`RoomType` 及其按晚的 `RoomAvailabilityRecord`、`HotelReservation`、
`FlightReservation`、`Itinerary`、`Notification`，内置航班服务商写入的
`AfsOfflineBooking` 账本，以及自动补全所用的 `City` / `Airport` 参照表。
`prisma/migrations/` 下的迁移是修改表结构的唯一受支持方式。

### 类型层

`types/` 是一个纯类型层，在构建期会被完全擦除：传输层信封（`api.ts`）、令牌声明与鉴权
上下文（`auth.ts`）、响应 DTO（`models.ts`）、AFS 外部契约（`afs.ts`）以及 App Router
参数类型（`next.ts`），并由 `index.ts` 统一导出。

### 三套 TypeScript 配置

`app/` 下所有内容（包括路由处理器）的编译由 Next.js 负责。`next build` 会做类型检查并
打包进 `.next`，因此应用配置（`tsconfig.json`）是 `noEmit`，并且排除了 `tests/`。

`lib/`、`types/` 以及 `prisma/` 下的播种脚本不是框架代码，因此通过
`tsconfig.server.json` 走常规的编译输出（`rootDir` → `outDir: dist`，CommonJS，
`strict`），由 `npm run build:server` 执行。`lib/` 内部只使用相对导入，这正是那份产物
无需路径别名解析器就能被纯 `node` 直接运行的原因。

测试套件有独立的 `tsconfig.test.json`，它继承应用配置，并额外纳入 `tests/`、
`vitest.config.ts` 以及 `#support/*` / `#setup/*` 别名 —— 应用配置不能包含测试，
否则会把测试代码拖进生产包。`npm run typecheck` 运行应用配置与测试配置；服务端配置
由它自己的编译命令 `npm run build:server` 完成类型检查。

---

<a id="design-decisions"></a>

## 设计决策

### 每个房型每晚只有一条可用量记录

`RoomAvailabilityRecord` 上有 `(roomTypeId, date)` 唯一索引。所有读取与带条件的扣减都只
针对"某一晚"，因此同一天若出现第二条记录，就会把一晚的库存拆到两条记录上，让一次预订占用
超过实际存在的房间数。预订流程依赖这一点：它用一条 `updateMany` 抢占整个住期，并把受影响
行数与住期天数比较。该不变量由数据库而非应用代码保证，因此任何新增的写入路径都无法绕过它。

### 预订是"抢占"，不是"先查后写"

`POST /api/hotels/book` 在事务内用
`updateMany({ where: { …, availability: { gt: 0 } } })` 扣减，并把行数不足视为售罄（`409`）。
取消是它的严格逆操作，并由状态迁移守卫，因此只会生效一次。"先读再写"会引入竞态：两个并发
请求可能都观察到有库存，然后都继续下单。

### 上游出票系统是权威系统

`createFlightReservation` 先在上游出票，再在本地写入镜像记录；若本地写入失败，则请求 AFS
把票退掉。当这次补偿也失败时，该订单就成了**孤儿**：上游已出票，本地却查不到。这种状态无法
在本次请求内修复，因此会以结构化告警写入日志：

```
[event] 12 {"event":"flight.booking.orphaned","alert":true,
            "detail":{"bookingReference":"…","cause":"…","reason":"…"}}
```

每一条 `alert: true` 的记录都代表一笔需要与供应商人工对账的订单。若补偿成功，则记录
`flight.booking.compensated`，无需人工处理。

### 在已提交变更之后发生的写入，不允许让请求失败

`lib/api/notify.ts` 会写通知但不向上传播失败：它所描述的那笔预订或取消已经落库，而客户端
会把任何错误理解为"你的预订失败了"，从而引导用户重试，造成第二次预订。

### 限流是按进程、存在内存中的

`lib/api/rate-limit.ts` 保护登录、注册与令牌刷新（防撞库）、个人资料的读取与写入、
被轮询的未读角标、通知列表、公开的酒店目录、向外发起的航班搜索，以及所有写端点 ——
其中结账的写配额最紧。配额是突发上限而非总量配额，因此部署后会重置，且 `429` 一定带
`Retry-After`。若扩展到多个实例，每个实例只会执行自己那一份配额：若需要更强的保证，
请在同一接口后接入共享存储。在 Vercel 上，每个 Serverless 实例本身就是一个独立进程，
所以这条限制在那里并非假设 —— 请把它当作"每实例的突发保护"来理解。

### 一张已上传的图片，要么是 Cloudinary 地址，要么是随包发布的占位图

`lib/api/upload.ts` 返回的是绝对的 `https://res.cloudinary.com/...` 地址，而 `hotel.logo`、
`user.profilePic` 以及图集默认值用的是 `/hotel-logo-default.svg` 这样的根相对路径。两种形态
存在同一列里，因此渲染代码在改写字符串前必须先判断：给一个绝对地址加上 `/` 前缀会得到
`/https://…`，浏览器会把它当作本站路径去解析，必然加载失败。
[`app/profile/page.tsx`](./app/profile/page.tsx) 里的 `toPreviewSrc()` 与
[`next.config.ts`](./next.config.ts) 里的 `images.remotePatterns` 就是承载这条约定的两处。

### 每个工作进程一个 Prisma 客户端，缓存在 `globalThis` 上

`lib/prisma.ts` 在所有环境下都做缓存，而不只是开发环境。Serverless 平台会运行大量短生命
周期的工作进程，若每次模块求值都新建客户端，就会变成"每个进程一个连接池" —— 这正是流量高峰
打向连接池端点时演变成 "too many connections" 的原因。缓存正是"每个进程一个连接池"这一预期
形态的实现方式：表里只有一项，它就是模块本来也会导出的那个客户端，运行时会在工作进程回收时
一并释放。

### 运行时绝不写入本地文件系统

图片进入 Cloudinary，所有状态进入 PostgreSQL，因此生产环境不需要可写磁盘。这正是 Serverless
部署得以成立的前提：函数的磁盘是只读且随实例销毁的。在测试环境下（未配置 Cloudinary 凭据
时），`lib/api/upload.ts` 会返回形如 `/uploads/...` 的 mock 地址 —— 与基于磁盘的存储会产生的
URL 形状一致 —— 这样只断言"返回了新的图片地址"的用例无需网络调用即可通过。Docker 镜像中的
`public/uploads/` 目录只为这种形状与本地开发而存在，部署环境中没有任何代码会写入它们。

### 航班服务商是"降级"而不是"失败"

无论数据来自哪个后端，`lib/afs-client.ts` 都会在返回前对每个响应做结构化校验，并把失败统一
报为 `502`（上游状态码放在 `details` 里）。上游的 `401` **不会**被转发：浏览器把 `401` 理解为
「登录状态已过期」，转发 AFS 对本应用 API Key 的拒绝会导致用户被登出。后端是**按每次调用**
决定的，因此测试套件无需任何模块打桩即可固定使用内置服务商。

---

<a id="getting-started"></a>

## 快速开始

### 前置条件

- Node.js 20 或更高版本
- PostgreSQL 15 或更高版本，本地或托管（Neon、Supabase、RDS）
- 一个 Cloudinary 账号，用于图片上传

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

然后填写 `.env`。该文件已被 Git 忽略，因此密钥只能放在这里，绝不能写进源码、Dockerfile
或 `docker-compose.yml`。全部变量见[环境变量](#environment-variables)。

### 3. 准备数据库

```bash
npm run prisma:generate   # 生成 Prisma Client
npm run prisma:migrate    # 应用迁移
npm run seed              # 导入城市、机场与演示数据（仅限可随意丢弃的库）
```

### 4. 启动

```bash
npm run dev               # http://localhost:3000
```

---

<a id="environment-variables"></a>

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | Prisma 使用的 PostgreSQL 连接串 |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | 仅用于自带的 docker-compose 栈 |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | 令牌签名密钥 —— 请使用足够长的随机值 |
| `JWT_ACCESS_TOKEN_EXPIRY_TIME` | 访问令牌有效期，例如 `1h` |
| `JWT_REFRESH_TOKEN_EXPIRY_TIME` | 刷新 Cookie 有效期，例如 `7d` |
| `AFS_BASE_URL` | AFS 服务地址；留空、非 HTTP 协议或指向文档中的占位主机，都表示使用内置服务商 |
| `AFS_API_KEY` | 发给远程 AFS 服务的 API Key；仅在确实使用远程服务时需要 |
| `AFS_MOCK` | 设为 `true`（也接受 `1`、`yes`、`on`）强制使用内置服务商；不设置时由 `AFS_BASE_URL` 决定 |
| `AFS_LOCAL_AGENCY` / `AFS_SEED_DAYS` | 由自带的 AFS 容器读取：它播种的代理名，以及生成多少天的航班时刻表 |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | 图片存储的凭据 |
| `CLOUDINARY_URL` | 上面三个值的单变量替代写法 |
| `CLOUDINARY_FOLDER` | 上传资源的根目录，默认 `flynext` |
| `SEED_OWNER_EMAIL` | 可选。`npm run seed:reference` 创建的参考酒店归属账号，默认 `hotel-owner@flynext.local` |
| `SEED_OWNER_PASSWORD` | 可选。固定该账号的密码；不设置时由播种脚本随机生成并打印一次 |

生成签名密钥：

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

<a id="scripts"></a>

## 命令一览

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动 Next.js 开发服务器 |
| `npm run postinstall` | 生成 Prisma Client；`npm install` 后自动执行 |
| `npm run build` | 生产构建（同时编译应用和 API 路由到 `.next`） |
| `npm run vercel-build` | Vercel 实际执行的命令：`prisma generate && next build` |
| `npm start` | 运行生产构建产物 |
| `npm run build:server` | 用 `tsc` 把 `lib/`、`types/` 与 `prisma/` 单独编译到 `dist/`（可直接运行的 CommonJS） |
| `npm run typecheck` | 对应用与测试代码做类型检查 |
| `npm test` | 单次运行集成测试 |
| `npm run test:watch` | 以监听模式运行测试 |
| `npm run seed` | 导入**演示/重置夹具**（`tsx prisma/seed.ts`）——先清空相关表，再重建 50 个演示用户、酒店、订单与行程 |
| `npm run seed:reference` | 导入**生产参考数据**（`tsx prisma/seed-reference.ts`）——只新增城市、机场、酒店、房型及其按晚可用量，不删除任何数据 |
| `npm run seed:prod` | 运行已编译的演示夹具（`node dist/prisma/seed.js`） |
| `npm run seed:reference:prod` | 运行已编译的参考数据播种（`node dist/prisma/seed-reference.js`） |
| `npm run prisma:generate` | 重新生成 Prisma Client |
| `npm run prisma:migrate` | 应用待执行的迁移（`prisma migrate deploy`） |

以下脚本不通过 npm 调用，直接执行：

| 命令 | 作用 |
| --- | --- |
| `node scripts/audit-env.mjs` | 检查部署环境变量，详见[部署](#deployment) |
| `node afs/seed-flights.mjs` | 为自建的 AFS 容器播种数据库；通常由该容器入口脚本调用 |
| `npx tsx scripts/repair-flight-directions.ts` | 审计全部航班订座，重建其中没有携带航班列表的方向记录。默认只做检查；`--apply` 先写入 JSON 备份再改写，`--restore` 把备份中的取值放回 |

---

<a id="testing-and-verification"></a>

## 测试与验证

集成测试连接的是**真实**数据库，因为它覆盖的行为 —— 带条件的库存扣减、唯一约束、交互式
事务 —— 只存在于那里。它使用自己的临时数据库，而不是开发库：

```bash
cp .env.example .env.test
# 然后把 .env.test 里的 DATABASE_URL 指向一个临时库，例如 .../flynext_test
npm test
```

该数据库名**必须**以 `_test` 结尾。测试会在用例之间清空它用到的表，并拒绝在其它数据库上
启动，因此不可能误伤开发库。首次运行时迁移会自动应用。

测试覆盖并发下的超卖防护、房型容量与按晚库存、航班下单的一致性与补偿、订座记录的方向、
订座列表及其渲染、上传目录的处理、输入校验、鉴权边界、限流，以及内置航班服务商的契约。

### 验证闸门

提交 Pull Request 或推送前，请跑通以下三道关卡：

```bash
npm run typecheck   # 0 error
npm test            # 全部通过
npm run build       # 生产构建成功
```

---

<a id="api-conventions"></a>

## API 约定

以下约定对浏览器客户端是载荷式的。

- **错误**统一为 `{ "error": string }`，并配有恰当的状态码
  （`400` 校验失败、`401` 未认证、`403` 无权限、`404` 不存在、`409` 冲突、
  `429` 触发限流、`502` 上游失败）。
- **动作成功的响应**为 `{ "message": string }`，通常还会带上新建的资源。
- **数值字段是 JSON 数字**，绝不是字符串：多个页面直接对它们调用 `.toFixed(2)`。
- `GET /api/itineraries/{id}` 的响应体**就是**行程对象本身（不包裹）。
- `GET /api/flights/search` 返回**裸数组**（航班分组）。
- `GET /api/user/hotel-bookings` 使用嵌套的 `period` 信封，而
  `GET /api/user/hotel-bookings/{id}` 把入住日期平铺返回。两种形态都是有意为之，分别服务于
  不同的页面。
- `IsHotelOwner` 保留大写的 `I`；有三个页面依赖它做房主专属 UI 的门控。
- 航班航段用单空格哨兵 `" "` 表示"无值"。
- 每个处理器都包在 `lib/api/handler.ts` 的 `withRoute` 中，它是唯一把抛出的 `ApiError`
  转成响应的地方。仅在单个路由里重复这一职责的 `try`/`catch` 是对该边界的重复实现。

---

<a id="flight-provider"></a>

## 航班服务商

航班数据来自 Advanced Flights System —— 一个独立的 Next.js 服务，拥有自己的数据库，开源
地址为 [Kianoosh76/afs](https://github.com/Kianoosh76/afs)。
[`lib/afs-client.ts`](./lib/afs-client.ts) 实现 AFS 契约，其下挂着两个可互换的后端，
因此没有任何路由处理器或页面需要关心是哪一个在应答。

### 后端是如何选择的

在 [`lib/afs/config.ts`](./lib/afs/config.ts) 中**按每次调用**决定，优先级从高到低：

| 条件 | 后端 |
| --- | --- |
| `AFS_MOCK` 为 `true`、`1`、`yes` 或 `on` | 内置服务商 |
| `AFS_BASE_URL` 不可用 | 内置服务商 |
| `AFS_MOCK=false` | 远程服务（显式声明） |
| 其余情况 | 远程服务 |

只有 `http`/`https` 地址才算数，`https://afs.invalid` 这类文档中的占位地址会被视为
**未配置**而不会被真正请求。这正是 CI 在没有服务的情况下依然能通过的原因：`.env.test`
同时设置了 `AFS_MOCK=true` **和**占位地址，因此即便标志被删除，测试也不可能打到真实服务。

远程调用还要求 `AFS_API_KEY`；缺少它时调用会以 `502` 失败，而不会悄悄改用内置服务商。
`AFS_MOCK=false` 表达的是"要走 HTTP"的意图，但它无法提供地址：当 `AFS_BASE_URL` 缺失或
是占位地址时，位于它上方的规则已经选中了内置服务商。

按调用而非在导入时解析，使得测试或健康检查无需任何模块打桩就能固定使用任意一个后端。

### 方案 A：内置服务商（默认）

[`lib/afs/offline.ts`](./lib/afs/offline.ts) 在进程内实现了 `GET /api/cities`、`/airports`、
`/airlines`、`/api/flights`、`POST /api/bookings`、`GET /api/bookings/retrieve` 与
`POST /api/bookings/cancel`，错误信息与状态码都与上游一致。

它是**替身而不是桩**。桩只会返回一份写死的搜索结果，下一次调用就会崩掉；而它维护真实状态：

- 搜索返回的行程 id **本身就说明了它是什么** —— `YYZ-LHR-20260701-0725-00` 依次是出发地、
  目的地、日期与起飞时刻 —— 而时刻表是「航线 + 日期」的纯函数。因此任何一个实例都能解码 id、
  重建当天的时刻表，并确认该起飞时刻确实是时刻表上的航班，根本不需要见过产生它的那次搜索。
  同一次搜索永远得到同一批 id，id 在**下一次**请求中依然有效，这正是下单所必需的。
- 下单会真实扣减一个座位、减少 `availableSeats`，并返回一个订座号 —— `retrieve` 与 `cancel`
  凭「姓氏 + 订座号」就能再次找到这笔订单。
- 取消会把订单置为 `CANCELLED` 并把座位还回去，且只还一次。
- 它会执行真实的上游规则：不存在的航班 id、少于 9 位的护照号、前后重叠或中转衔接不足一小时的
  航段、超卖。FlyNext 的补偿逻辑正是因为这些拒绝会真实发生才存在。
- **搜索给出的每一份行程，下单都一定接受。** 若某条航线当天唯一的衔接不满足一小时最短中转
  时间，返回的会是**次日**的第一班衔接，而不是两个时间上重叠的航班。给出无法下单的选项，
  只会把拒绝推迟到下单的最后一步，并以 `Flights are not consecutive in sequence` 的形式暴露。

搜索 → 下单 → 查询 → 校验 → 取消 → 退款/补偿 全链路都能闭环，**往返程**也不例外（往返是两次
搜索、两批 id）：它作为**一个**订单发送，去程航段在前，因此返程日期必须晚于去程日期。该请求
还会带上 `returnLegCount`（末尾有多少个 id 属于回程），因为服务商返回的是一条扁平的航段列表，
并不会说明去程到哪里结束：没有它，"带中转的单程票"与"往返票"形状完全相同，订座历史就可能把同一
趟行程的航段渲染成 "Outbound" 与 "Return" 两块。这个字段只属于我们 —— 它在下单时被本地消费，
绝不转发给上游 —— 而省略它的调用方，其方向拆分改由航段推导（见
[`lib/reservations.ts`](./lib/reservations.ts) 的 `splitFlightDirections`）。

一条订座记录保存的是**方向（direction）**，而不是一个个航段：`YYZ→HKG→CAN` 是一个完整的去程
方向（多伦多到广州），保存为从 YYZ 出发、在广州落地，而香港中转留在该方向的航班列表里。订座
相关页面读取这份列表，因此带中转的机票会显示在哪里转机（"Via HKG"）以及它由哪些航班组成 ——
只写两个端点的摘要读起来就是一趟直飞。
`npx tsx scripts/repair-flight-directions.ts` 会把库中的方向记录与机票核对，并用 `--apply`
重建其中缺少航班列表的那些。

订座是**持久化**的。它会在服务商应答之前写入 `AfsOfflineBooking` 表，因此在一个 Serverless
实例上买的票，可以从任何其他实例查询与取消；取消也会在所有实例之间只归还一次座位。座位数是
推导出来的 —— 某航班的可用量等于它发布时的座位数减去引用它的有效订座 —— 而不是维护一个进程内
计数器，这正是两个实例能够对座位数保持一致的原因。当账本已配置却拒绝这笔写入时，已抢占的座位
会被归还，调用方收到 `502`：若此时回答"已确认"，就等于交出一张别的实例既无法核验也无法取消
的票。

表里没有对应行的订座同样有答案：服务商会回退到调用方自己的 `FlightReservation` 行，因此即使
账本中没有这笔记录，订座号依然可查询、可取消。持久化的一半在 `lib/afs/ledger.ts`；若没有
`DATABASE_URL`，服务商会降级为只用内存提供订座，这在单进程部署下是正确的。

### 方案 B：自建 AFS 服务

```bash
docker compose --profile afs up -d     # 额外启动 `afs` 与 `afs-postgres`
```

[`dockerfile.afs`](./dockerfile.afs) 会从上游仓库源码构建（`AFS_REF` 可固定版本）。该容器的
入口脚本先应用上游迁移，然后执行 [`afs/seed-flights.mjs`](./afs/seed-flights.mjs)：它会
upsert 上游的机场、航空公司与一个代理（agency），并为滚动窗口（`AFS_SEED_DAYS`，默认 7 天）
生成航班时刻表。已经排好班次的日期会被跳过，因此重启很快，窗口也会自动向后延长。

然后让应用指向它：

```dotenv
AFS_BASE_URL="http://localhost:4000"    # 从宿主机访问
AFS_BASE_URL="http://afs:3000"          # 从 `nextjs` 容器内部访问
AFS_API_KEY="<AFS_LOCAL_AGENCY 的 sha256>"
```

默认代理名是 `flynext-local`，其 API Key 为：

```bash
node -e "console.log(require('crypto').createHash('sha256').update('flynext-local').digest('hex'))"
```

容器首次启动时会打印同一个值：`[seed] AFS_API_KEY=…`。
不用 Docker 也可以直接跑上游项目（`npm install`、`npx prisma migrate deploy`、
`npm run dev`）；任何其他部署方式同样有效，因为客户端只依赖 HTTP 契约。

搜索必须使用**未来**日期，且落在已播种的窗口内；没有时刻表的日期返回空列表是正常结果。
若要加入自己的代理，请在上游 `prisma/data/agencies.js` 中追加 id 并运行
`node prisma/data/import_agencies`。

---

<a id="docker"></a>

## Docker

```bash
./start.sh    # docker-compose up -d --build
./stop.sh     # docker-compose down
```

[`docker-compose.yml`](./docker-compose.yml) 会从 `.env` 读取 `DATABASE_URL`、
`POSTGRES_PASSWORD` 以及 JWT / AFS 相关配置。

若还想启动真实的 AFS 服务 —— 即从源码构建上游项目
（[Kianoosh76/afs](https://github.com/Kianoosh76/afs)，含独立 PostgreSQL 与自动生成的航班
时刻表）：

```bash
docker compose --profile afs up -d
```

这会额外启动 `afs` 与 `afs-postgres` 两个容器，并映射到 <http://localhost:4000>。
在 `.env` 中指向它：

```dotenv
AFS_BASE_URL="http://localhost:4000"   # 从宿主机访问
AFS_API_KEY="<AFS_LOCAL_AGENCY 的 sha256>"
```

在 compose 网络内部，应用通过服务别名 `http://afs:3000` 访问同一容器。AFS 镜像位于 `afs`
profile 之下，因此直接执行 `docker compose up` 只会启动 FlyNext 自身的服务栈。
细节见[航班服务商](#flight-provider)。

---

<a id="deployment"></a>

## 部署

本应用面向 Vercel 的 Serverless 模型打造：数据库是远程 PostgreSQL，图片存放在 Cloudinary，
Prisma 客户端按工作进程缓存而不是按请求创建。运行时不会向本地文件系统写入任何内容 ——
这正是 Serverless 部署得以成立的前提。

部署前可以先让仓库自检环境变量：审计脚本会列出哪些变量已设置、取值是否可用，以及未通过的
项该如何处理 —— 它从不打印变量取值本身，因此输出可以安全地贴进构建日志：

```bash
node scripts/audit-env.mjs        # 存在阻断部署的问题时以非零码退出
```

### 1. 导入仓库

1. 把项目推送到 GitHub。
2. 打开 <https://vercel.com/new> 并导入该仓库。
3. Vercel 会依据 `package.json` 自动识别 Next.js。框架预设、构建命令与输出目录全部保持默认值
   即可 —— 构建命令最终会解析到 `npm run vercel-build`，这个脚本是专为 Prisma 存在的。
4. 先不要部署。请先配置环境变量：缺少环境变量时，构建会在求值应用的阶段就失败，而不是等到
   第一个请求进来才报错。

### 2. 环境变量

在 **Settings → Environment Variables** 中逐条添加下表变量，三种环境（Production、Preview、
Development）都要勾选。键名必须完全一致。

| # | 键名 | 取值 |
| --- | --- | --- |
| 1 | `DATABASE_URL` | Neon 的连接池连接串，形如 `...?sslmode=require` |
| 2 | `JWT_ACCESS_SECRET` | 足够长的随机字符串 |
| 3 | `JWT_REFRESH_SECRET` | **另一个**足够长的随机字符串 |
| 4 | `JWT_ACCESS_TOKEN_EXPIRY_TIME` | `1h` |
| 5 | `JWT_REFRESH_TOKEN_EXPIRY_TIME` | `7d` |
| 6 | `AFS_BASE_URL` | **留空。** 本地 AFS 容器在 Vercel 上无法访问 |
| 7 | `AFS_API_KEY` | 仅当第 6 项指向公网可达的 AFS 服务时才需要 |
| 8 | `AFS_MOCK` | `true` —— 在 Serverless 上固定使用内置服务商 |
| 9 | `CLOUDINARY_CLOUD_NAME` | 取自 Cloudinary 控制台 |
| 10 | `CLOUDINARY_API_KEY` | 取自 Cloudinary 控制台 |
| 11 | `CLOUDINARY_API_SECRET` | 取自 Cloudinary 控制台 |
| 12 | `CLOUDINARY_FOLDER` | `flynext` |

几处容易踩坑的地方：

- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` 在 Vercel 上不需要。它们只用于配置
  随仓库提供的 `docker-compose.yml` 栈。
- 不要把 `AFS_BASE_URL` 指向 `localhost`。在 Vercel 上那指的是函数自己，而不是某台运行着
  AFS 的机器。留空（或设置 `AFS_MOCK=true`）会选择内置服务商，它在进程内完整实现了同一套
  契约。只有当部署环境确实能访问该地址时才填写 —— 本地容器并不满足这一条件，除非它被发布到了
  公网。
- `CLOUDINARY_URL` 是第 9–11 项的**替代写法**，不是补充项。二者选其一即可；若同时存在，
  以三个独立变量为准。
- 用 `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` 生成 JWT
  密钥，切勿把开发环境的取值复用到生产。
- 在 Neon 的**连接池**（pooler）主机上，连接串必须保留 `sslmode=require`；漏掉它通常是构建
  或运行时 TLS 报错的根因。
- `NODE_ENV` 由 Vercel 设置，不要覆盖。

### 3. 触发部署

向 Vercel 监听的分支（默认 `main`）推送即可，每次推送都会触发一次构建，每个 Pull Request
都会得到独立的 Preview 部署。请查看构建日志，确认在 `next build` 之前出现过 `prisma generate`
这一行 —— 路由处理器导入的那份带类型的客户端正是由它生成的。

### 4. 初始化生产数据库

构建过程从不触碰数据，因此表结构与参考数据需要手动执行一次。请在**生产** `DATABASE_URL`
已注入当前 shell 的前提下运行 —— 可以直接 export 与 Vercel 相同的取值，也可以让 Prisma 从
本地持有生产连接串的 `.env` 中读取。

```bash
# 1. 把全部迁移应用到生产库。
npx prisma migrate deploy

# 2. 导入参考数据：城市、机场、酒店与房型。
npm run seed:reference

# 3. 确认表结构与部署期望一致。
npx prisma migrate status
```

`prisma migrate deploy` 才是生产命令：它只应用待执行的迁移，既不会生成新迁移也不会重置数据。
切勿对生产库使用 `prisma migrate dev` —— 它可能为了消除漂移而删除数据。

如果希望每次部署都顺带执行迁移，请把 `prisma migrate deploy` 加到 Vercel 控制台的
**Build Command**，而不是写进 `package.json`，这样本地的 `npm run build` 仍然保持离线。

#### 内置服务商需要 `AfsOfflineBooking` 迁移

在认为部署完成之前，请先用 `npx prisma migrate status` 确认它已应用。内置航班服务商把订座放在
这张表里，好让在一个 Serverless 实例上买的票可以从另一个实例核验与取消；没有它，订座会退回
按进程内存保存，一张票只对卖出它的那个实例可见，从其它实例查询或取消都会得到
`Booking not found`。该表是纯增量的，其迁移不会创建别的东西，因此把它应用到持有真实数据的
库上是安全的。

`npm run seed:reference` 不会碰它，演示夹具同样不会 —— 但那个夹具是"重置"而不是"播种"，因此
在任何要紧的库上执行它之前，请先看下面的警告。

`npm run seed:reference` 是唯一适合在持有真实数据的库上执行的播种命令。它是**增量且幂等**的：
只补建缺失的数据，不删除任何内容，也不会自行捏造用户、预订、行程或通知。它只会写入
`City`、`Airport`、`Hotel`、`RoomType`、`RoomAvailabilityRecord` 这五张表，以及下面的那一个
运营账号。重复执行时各项都会显示 `0 created`，因此每次部署后执行都是安全的。

参考数据来自 `prisma/seed_data/*.json`（81 个城市、84 个机场），并按每个城市一家酒店、每家两个
房型生成，同时铺开一段按晚可用量，使搜索页与酒店页上线即有内容。这些酒店统一挂在一个运营账号下：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SEED_OWNER_EMAIL` | `hotel-owner@flynext.local` | 参考酒店归属的账号。`Hotel.ownerId` 才是管理权限的来源，因此没有 owner 时，这些酒店会列给所有人，却没有任何人能编辑它们。 |
| `SEED_OWNER_PASSWORD` | *（随机生成）* | 设置该值后脚本不会打印密码，并且重复执行会让库中密码与该值保持一致。 |

两个变量都不设置时，首次运行会创建该账号、把生成的密码打印一次，并且只保存它的 bcrypt 哈希 ——
请当场保存，之后无法找回。后续运行不会覆盖已保存的密码。

#### 切勿对生产库执行演示夹具

`npm run seed`（以及它的编译版本 `npm run seed:prod`）是**演示/重置夹具**，而不是增量播种。
`prisma/generate_data.sql` 开头就是 `TRUNCATE … RESTART IDENTITY CASCADE`，覆盖 `Airport`、
`City`、`Hotel`、`RoomType`、`User`、`HotelReservation`、`FlightReservation`、`Itinerary`、
`Notification`、`RoomAvailabilityRecord`，而演示用户的密码是公开的 `password1`…`password50`。
对着生产库执行它会直接清掉真实数据。请只在本地开发、以及数据库可随意丢弃的课程演示中使用它。

### 5. 验收部署

| 检查项 | 预期 |
| --- | --- |
| 首页可打开 | `200`，浏览器控制台无报错 |
| 注册 → 登录 | 账号创建成功，跳转到个人资料页 |
| 上传一张头像 | 跳转到 `https://res.cloudinary.com/...` 地址 |
| 创建一个带图集的酒店 | 酒店详情页正常渲染图片 |
| 搜索航班 | 返回 AFS 后端的结果（若已配置远程服务，此处报 `502` 说明 Key 被拒绝） |
| 结账 → 下载发票 | 成功生成 PDF |
| `npx prisma migrate status` | 输出 "Database schema is up to date!" |

任何图片上传返回 `502`，都说明 Cloudinary 存储未配置或凭据被拒；响应体不含任何密钥，函数
日志里则有服务商给出的原始错误信息。

### 推送到 GitHub

`.env` 与 `.env.test` 都已被 Git 忽略，因此密钥不可能经由它们进入仓库。`.env.example`
是唯一会被提交的环境文件，其中必须只保留占位符 —— 首次推送前请先 `git status` 确认。

---

<a id="layout"></a>

## 目录结构

```
app/
  api/                      # HTTP API —— 每个路由都是一个带类型的 route.ts 处理器
    auth/                   #   登录、登出、刷新、注册
    checkout/               #   把 DRAFT 行程确认为订单
    flights/                #   搜索、预订
    hotels/                 #   搜索、创建、详情、房型、房主视图、预订
    invoice/                #   PDF 发票
    itineraries/            #   创建、详情、取消
    locations/              #   城市与机场自动补全
    notifications/          #   列表、未读数、标记已读
    user/                   #   个人资料、航班订单、酒店订单
  components/               # 共享客户端组件（导航栏、角标、主题切换）
  context/                  # React Context Provider
  lib/                      # 仅客户端的辅助模块（订座展示、会话令牌）
lib/
  api/                      # 服务端基础设施
    errors.ts               #   ApiError 错误体系
    response.ts             #   JSON 信封辅助函数
    validation.ts           #   输入解析与校验
    auth.ts                 #   请求 -> AuthContext
    handler.ts              #   唯一的错误边界（withRoute）
    rate-limit.ts           #   进程内的按客户端请求配额
    events.ts               #   结构化、可检索的事件日志
    notify.ts               #   不允许让请求失败的通知写入
    upload.ts               #   带校验的图片上传，存到 Cloudinary
  afs-client.ts             # 航班服务商客户端（对两种后端做同样的校验）
  afs/
    config.ts               #   每次调用决定使用哪个后端
    ledger.ts               #   内置服务商的持久化订座状态
    offline.ts              #   进程内的 AFS 契约实现
  auth.ts                   # 密码哈希 + JWT 签发/校验
  prisma.ts                 # PrismaClient 单例
  reservations.ts           # 共享的预订生命周期逻辑
afs/
  seed-flights.mjs          # 为自建的 AFS 容器播种数据库
  docker-entrypoint.sh      # 在该容器内迁移、播种，然后启动服务
dockerfile                  # 应用自身的镜像（compose 服务 `nextjs`）
dockerfile.afs              # 基于上游仓库构建 AFS 容器
scripts/
  audit-env.mjs             # 部署环境变量审计
  repair-flight-directions.ts  # 审计并重建库中保存的航班方向记录
prisma/
  schema.prisma             # 数据模型
  migrations/               # SQL 迁移
  seed.ts                   # 演示/重置夹具（先清空相关表）
  seed-reference.ts         # 增量式的生产参考数据
  seed-fixtures.ts          # 共享的夹具路径解析
  sql-script.ts             # 把 .sql 文件切成单条语句
  seed_data/                # cities.json 与 airports.json
  generate_data.sql         # 由 seed.ts 逐条执行的演示/重置 SQL
tests/
  support/                  # 数据库、工厂与请求辅助函数
  setup/                    # 测试环境与迁移引导
  *.test.ts                 # 测试套件
types/                      # 共享类型层（纯类型，构建期擦除）
  api.ts                    #   传输层信封
  auth.ts                   #   令牌声明与鉴权上下文
  models.ts                 #   响应 DTO
  afs.ts                    #   外部接口契约
  next.ts                   #   App Router 参数类型
  index.ts                  #   barrel
```

---

<a id="license"></a>

## 许可

本项目用于教学与作品展示。如需商用，请先联系仓库所有者。

---

## English documentation

本文件是 [README.md](./README.md) 的中文译本。
