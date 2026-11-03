# 谁是卧底 · 聚会联机版

以用户提供的 `ai.tsx` 为准恢复的 React 项目。原始文件完整保留在 `reference/ai.original.tsx`，原版界面在 `src/App.tsx`。

## 保留的玩法

- 每人用各自手机，输入四位房号加入；Firebase 匿名身份与 Firestore 实时同步。
- 精选分类词库、AI 主题命题、三种 AI 主持风格和语音播报。
- 1—3 名卧底、白板、同屏补位与同屏测试玩家自动投票。
- 秘密看牌、发言计时、发言关键词记录、投票、平票 PK、出局结果和胜负结算。
- 房主直接开始发言、提前截止投票、立即再来一局和回大厅调整设置。
- 游戏中随时按住查看自己的底牌，松开、切换视角或离开页面即隐藏。

## 当前状态

这是待接入实际 Firebase 项目的修复分支。正式主页暂时仍是上一版，未用缺少服务配置的版本覆盖它。

已完成 React 打包、后端游戏流程、底牌分离、数据库访问规则、AI 服务调用及测试代码。尚未部署 Firebase、完成真实多设备和真实 AI 验收。源码与本地模拟器通过不代表公网服务已接通。

## 数据与权限

原版把所有人的词语、身份和投票目标都发给每台手机。修复版将完整状态存入客户端不可读写的 `games/{appId}/rooms/{code}/server/state`，由 Cloud Functions 校验身份、阶段和房主权限后在事务中更新。

- 房间公共文档只对成员可读，不能列出全部房间，不能从客户端直接修改。
- 每位真实玩家只能读取自己的 `hands/{uid}`；房主的文档额外含同屏补位玩家的词语，不含其他手机玩家的底牌。
- 底牌文档不透露玩家是平民或卧底；真实身份在出局时公开，完整词语在终局公开。
- 投票阶段只公开谁已投票；各自的投票目标保存在私有文档。
- AI 生成也在服务端执行，房主不会因为点击 AI 命题收到双方答案。生成失败明确提示，不用固定内容冒充 AI。
- 请求携带阶段编号；旧阶段的发牌、投票、发言操作会被拒绝。房间 24 小时过期。

## 开发与验证

使用 Node.js 22。数据库本地模拟器需要 Java；当前锁定的模拟器版本支持 Java 17。

```sh
npm ci
npm ci --prefix functions
npm test
npm run test:emulator
npm run build
```

`npm test` 检查游戏流程、权限判断、底牌投影、并发更新所用的状态归约逻辑、AI 响应校验和真实 React 大厅渲染。

`npm run test:emulator` 使用 `demo-undercover` 本地项目，启动 Auth 与 Firestore，直接执行实际 Cloud Function handler。覆盖多个独立身份、事务并发、实时监听、数据库拒绝越权访问、完整对局及重开。本测试不覆盖云函数 HTTP 包装、生产 App Check 和真实模型请求；这些必须在实际项目部署后验证。

浏览器构建输出在 `dist/`。所有代码、图标与样式本地打包，不把 TSX 当 HTML 上传。

## 实际部署

1. 连接用户自己的 Firebase 项目，确认项目及所在地区。Cloud Functions 生产部署需要 Blaze 计划；若现有项目未开通，必须由账户所有者决定是否开通计费。
2. 开启匿名 Authentication 和 Firestore。将 GitHub Pages 域名添加到认证授权域名及 App Check 的站点配置。
3. 在 `public/config.js` 填写该 Web App 的公开配置与 App Check 站点 key。这里不放服务账号或 Gemini 私密 API key。
4. `functions/index.mjs` 默认区域为 `us-central1`，需要和前端 `functionsRegion` 一致。部署后端与 `firestore.rules`；生产函数强制 App Check。
5. AI 使用 Vertex AI 的 Gemini REST 接口和云函数运行身份。为该项目开通模型服务、给运行身份必要权限，并在后端设置 `AI_ENABLED=true`、实际可用的 `AI_MODEL` 和 `AI_LOCATION`。默认 AI 关闭；没有模型配置时精选词库仍可用。不能把模型名称是否存在或费用视为已经确认。
6. 使用已连接的部署工具或与当前 SDK 兼容的最新 Firebase CLI 部署；仓库锁定的 CLI 仅用于上述本地 Auth/Firestore 测试。没有创建项目、启用计费或部署外部服务的自动脚本。
7. 用多个独立手机/浏览器身份验证建房、加入、秘密看牌、发言、投票、PK、终局、重开，以及三个风格的真实 AI 响应。确认后将 `dist/` 内容发布到现有 GitHub Pages。

参考：[Firebase Callable Functions](https://firebase.google.com/docs/functions/callable)、[Cloud Functions 部署前提](https://firebase.google.com/docs/functions/get-started)、[Firestore Rules](https://firebase.google.com/docs/firestore/security/rules-conditions)。
