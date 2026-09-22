# @ldd/dsh-canvas

LDD 的画布插件：为 DeepSeek Harness 提供一块可视化无限画布，用节点（图片 / 视频 / 音频 / 文本 / 笔记）+ 连线组织素材，并且**与 agent 双向衔接**——agent 通过 `canvas_*` 工具读写画布，用户在界面上拖拽 / 连线 / 增删改，两边共享同一份持久化状态。

## 功能

- **双向编辑**：agent 通过 `canvas_inspect` / `canvas_add_node` / `canvas_remove_node` / `canvas_update_node` / `canvas_link` 五个工具改画布；用户直接在画布上拖节点、连线、双击建卡、拖线到空白建节点，改动通过 typert remote verb 写回，零 agent 往返。
- **媒体上传**：图片拖拽 / 菜单 / 对话框三种入口上传，图片按原始画幅比例呈现（不裁剪）；视频 / 音频落为素材卡片。
- **平滑连线**：贝塞尔曲线（非折角）。
- **即插即用**：自包含插件，卸载 = 从插件根目录移除一行。

## 架构

- **Host 侧**（`src/index.ts`）：注册 `canvas_*` 五个工具；画布状态**不存内存 Map**，每次 mutate 后向 session 追加一条 whole-value 的 `canvas/state` 事件，读时从 `snapshotEvents()` 折叠——resume / fork 天然正确。另注册一个 `canvas` session projection（`stateVersion: 1`）作为客户端读面。
- **Client 侧**（`src/client/`）：React Flow 画布，同一份状态两个席位——右侧 Sidebar 的页类型 tab（`kind: 'canvas'`）和会话视图的「画布」tab。
- **纯数据模型**（`src/model.ts`）：节点 / 连线类型 + 纯状态转移，双端共享、可直接跑 strip-only 测试。
- **写回服务**（`src/remote.ts`）：`CanvasService`（typert remote），把用户编辑映射为 durable `canvas/state` 事件；`inspect` / `addNode` / `removeNode` / `updateNode` / `moveNode` / `link` / `saveAsset` 七个 verb。

## 现状

源码开源。**独立构建 + npm 发布正在准备中**——当前 `client` bundle 依赖 DeepSeek Harness monorepo 的 tsdown 预设（`clientBundle`）和 typert remote 生成器，独立仓库的解耦构建方案见 Issues（roadmap）。

在 Harness monorepo 内构建：`pnpm --dir packages/canvas build`（`lib/`），客户端 bundle 走 `pnpm --dir packages/canvas bundle`（`tsdown`）。

## License

[MIT](./LICENSE)
