# RailSketch · 铁路配线图编辑器

> 作者：**Shangru Li** · 联系：[lishangru@lishangru.cn](mailto:lishangru@lishangru.cn)
> 协议：[CC BY-NC 4.0](LICENSE) —— 允许转载、修改与再分发，但**必须署名原作者 Shangru Li**，且**禁止任何商业用途**。详见 [协议说明](#11-协议与署名)。

一个面向铁路枢纽图、车站股道配线图、地铁配线图与公共交通线路示意图的**轻量级桌面 Web CAD 编辑器**。

第一阶段仅实现电脑版前端，无后端。编辑器采用结构化数据模型：用户编辑的是铁路图元对象，Canvas 2D 只负责渲染，项目可保存 / 导入 JSON Document。

---

## 1. 技术栈

| 类别 | 方案 |
| --- | --- |
| 框架 | Vue 3（Composition API） |
| 语言 | TypeScript（strict） |
| 构建 | Vite |
| 状态 | Pinia |
| 画布 | 原生 HTML5 Canvas 2D |
| 样式 | SCSS |
| ID | uuid |

不依赖 Fabric.js / Konva.js / SVG 主画布 / DOM 模拟轨道。

---

## 2. 启动命令

```bash
npm install
npm run dev
```

默认地址：<http://127.0.0.1:5173>。开发服务默认仅监听本机；确需局域网访问时显式运行 `npm run dev -- --host 0.0.0.0`，不要将开发服务暴露到不可信网络。

生产构建：

```bash
npm run build
npm run preview
```

类型检查：

```bash
npm run typecheck
```

回归测试（Node.js 22 或更高版本）：

```bash
npm test
npm run test:smoke
npm audit
```

`npm test` 先检查测试代码类型，再使用 esbuild 与 Node.js 内置测试运行器执行逻辑、安全边界、存储及模拟指针事件测试。`test:smoke` 执行原有功能冒烟用例；两者不替代真实浏览器视觉验收。

### 文件与保存边界

- 导入文件上限为 **10 MiB（UTF-8 字节）**；坐标绝对值不超过 1,000,000，网格大小为 1–10,000。
- 另限制图元、点、节点、引用、文本总量及交叉计算工作量；超过限制会拒绝导入并显示原因，不替换当前文档。具体常量见 `src/editor/serialization/serializer.ts`。
- v1/v2 文档仍支持迁移；重复 ID、非法数值和无效几何会拒绝，悬空引用会按兼容规则清理。
- 自动保存仅在浏览器存储写入成功后显示已保存。配额不足或存储被禁用时会提示失败；`Ctrl+S` 导出独立备份不会掩盖自动保存错误。
- 图层隐藏/锁定是编辑约束，不是身份认证或访问授权。项目当前无服务端权限体系。

---

## 3. 操作速览

| 操作 | 说明 |
| --- | --- |
| 鼠标滚轮 | 围绕光标缩放（10% ~ 500%） |
| Space + 左键拖动 / 鼠标中键 | 平移画布 |
| `V` | 选择工具（点击图元 / 控制点，Ctrl 多选，框选） |
| `T` | 轨道工具（连续点击，双击结束；Esc 取消整条草稿） |
| `W` | 道岔工具（点击主线 → 像画轨道一样连续画岔线折线，主线不拆线） |
| `G` | 箭头 / 虚线工具（同轨道工具画折线，属性面板设虚线 / 箭头） |
| `E` | 橡皮擦（按住左键拖线，经过的实体被切断 / 删除） |
| `N` | 节点编辑（显示 / 拖动 / 合并拓扑节点） |
| `S` | 段编辑（沿段法向平移，Alt 自由平移） |
| `P` | 站台工具（两次点击生成细长矩形） |
| `L` | 文字工具（点击后输入文字） |
| 轨道绘制时按住 `Alt` | 临时取消 0° / 45° / 90° 八方向角度吸附 |
| 点击空白处 / Esc | 取消当前草稿 / 取消选择 |
| 拖动控制点 | 修改轨道 / 线几何（带网格 / 点 / 虚拟对齐吸附） |
| 点击控制点 | 单独选中点（可拖动、Delete 删除、Ctrl 多选点） |
| 多选同类图元 | 属性面板可批量修改属性（一次撤销） |
| Delete / Backspace | 删除选中对象 / 选中点 |
| `Ctrl + Z` | 撤销 |
| `Ctrl + Shift + Z` / `Ctrl + Y` | 重做 |
| `Ctrl + S` | 导出 `.rail.json` |
| `Ctrl + O` | 打开 JSON 项目 |

输入框获得焦点时，快捷键不会误触。

---

## 4. 已实现功能（第一阶段）

### 文档与图元
- 结构化 `RailDocument` JSON：画布设置、图层、图元。
- 三类核心图元：
  - **Track**：单线 / 双线轨道，中心 Polyline 编辑，双线自动偏移渲染；
  - **Platform**：水平、垂直、45° 方向站台；文字字号随站台宽度自动适配；可分别设置站台颜色与文字颜色；
  - **Label**：线路名称、站名、方向标记。
- 图元统一包含 `id / type / layerId / visible / locked`。

### 拓扑与专业铁路对象
- `RailDocument.version = 3`，新增 `nodes`、`crossings`。
- `RailwayNode`：`endpoint / junction / switch / crossing` 四类拓扑节点；Track 通过 `startNodeId / endNodeId` 成为拓扑边。
- **道岔不拆线**：节点通过 `vertexLinks`（trackId + 顶点下标）挂在轨道内部顶点上，主线保持连贯；岔线 / 汇入线以 switch 节点为起点或在中点汇入。
- 绘制轨道时，端点 / 中间顶点吸附到既有线路中间会自动插入顶点并建立 switch 节点（不拆线）；落在既有节点上自动复用 / 追加连接。
- 道岔工具（W）：点击主线确定锚点后，岔线像画轨道一样连续绘制折线（角度吸附、双击结束、Esc 取消），一次撤销。
- `splitTrackAtPoint()`：通用底层拆线能力，交叉连接 / 节点合并共用。
- `mergeNodes() / splitNode() / reverseTrack() / validateTopology()`：节点合并、拆分、反转与一致性检查。
- 拓扑图查询：`getConnectedTracks / getNeighborNodes / isConnected`。
- 几何相交不等于拓扑连接：默认交叉不建立 Connection。
- `segmentIntersection()` 交点检测；`LinearSpatialQuery` 预留空间索引接口。
- 平行轨道工具：通用 `offsetPolyline()`（含 miter limit），一次生成多条独立 Track，一次撤销 / 重做。
- 节点编辑：拖动节点，所有直连轨道端点 / vertexLinks 顶点同步跟随；靠近另一节点时自动合并。
- 段编辑：选中 Segment 沿法向约束平移，相邻段自动伸缩保持连接。
- 交叉右键：连接两条线路 / **设为道岔**（不拆线，交点处共用 switch 节点）/ 取消连接 / A 跨 B / B 跨 A / 普通交叉；节点右键可**设为道岔**（切换节点类型）。
- 方向标识：`direction-marker` 自动跟随绑定轨道端点方向；文字可保持可读或始终水平；**可设置字号、箭头大小与线宽（粗细）**，箭头支持正向 / 反向 / 隐藏。
- v1 / v2 旧 JSON 自动迁移到 v3，旧 Track 自动补建端点节点，旧节点补空 `vertexLinks`。

### 编辑器核心
- `Editor Core` 不依赖 Vue / Pinia；`Renderer` 不依赖 Pinia；`Document Model` 不依赖 Canvas。
- 世界坐标 + 相机变换：`screen = world × zoom + offset`。
- 高 DPI（Retina）Canvas backing store 适配。
- ResizeObserver 自动响应容器尺寸变化。
- `requestAnimationFrame + invalidate()` 渲染调度，不在 pointermove 中随意堆积 RAF。
- 无限网格：世界坐标绘制，随 zoom 自适应细分密度。
- 网格显示 / 网格吸附两个独立开关。

### 交互
- 选择工具：几何 HitTest（点到线段最短距离，阈值 `8 / zoom`），重叠时取最近对象。
- **方向标识 / 文字优先**：点击标识或文字的文字框位置时优先选中它本身，即使与线路或控制点重叠。
- **控制点单独选择**：轨道 / 线的顶点可单独选中（实心高亮）、拖动、Delete 删除、Ctrl 多选后批量移动；顶点绑定拓扑节点（端点 / 道岔节点）时随动。
- 轨道选中高亮 + 全部控制点显示（小方块）。
- 控制点拖动：实时几何修改，支持 Grid Snap、Point Snap 与虚拟对齐。
- 轨道绘制：连续点击、实时虚线预览（点击第一点后移动鼠标即持续预览）、双击结束（带防抖，不会多画出一段线）、Esc 取消整条草稿、**Enter 直接结束提交**。
- 线路中心线吸附：绘制轨道且顶部“吸附”开关开启时，新线路端点 / 顶点会吸附到已有轨道中心线的最近投影点；关闭后不吸附线路与网格。
- **虚拟对齐**：吸附开启时自动识别可行对齐（与既有顶点共 x / 共 y，或落在轨道延长线上）并显示蓝色参考线；**优先级最高** —— 对齐线满足后，若可能再满足角度约束（角度射线与对齐线求交），其次满足网格（对齐线上取整），保证三者尽量同时成立。
- 八方向角度吸附：0° / 45° / 90° / 135° / 180° / 225° / 270° / 315°；Alt 临时自由角度。
- 站台 / 文字：点击创建、选择、拖动、删除。
- 轨道 / 站台 / 文字中部拖动：整体移动；**轨道拖动时独占的端点节点与道岔节点跟随移动**，共享节点自动断开连接，原位置不会留下孤立端点。
- 站台端点拖动：以另一端为旋转轴旋转站台（带 0° / 45° / 90° 八方向吸附），属性面板也可直接输入角度。
- 打开 / 新建项目时按全部可见图元的实际包围盒自动缩放居中，保证内容完整显示。
- 吸附提示点：命中网格 / 控制点 / 对齐线时在 Canvas 上高亮提示。
- 鼠标指针按工具 / 状态切换：default、crosshair、grab、grabbing、move、text。
- 状态栏实时显示世界坐标与缩放百分比。

### 属性面板与图层
- 未选择时显示文档名称、画布与网格设置。
- 选中 Track：名称、标注文字、单双线、角度（整条折线绕首段中点刚性旋转）、拐角圆角半径、线宽、双线间距、颜色、图层、删除。
- **线路标注文字**：设置后自动在轨道旁创建独立文字框（相当于按文字操作，可自由拖动 / 编辑 / 删除）。
- 选中 Line（箭头 / 虚线）：线型（实线 / 虚线）、箭头（无 / 起点 / 终点 / 两端）、线宽、颜色、图层、删除。
- 选中 Platform：站台名称、宽度、角度、站台颜色、文字颜色、图层、删除（文字字号随宽度自动）。
- 选中 Label：内容、字号、旋转角度、**显示 / 隐藏**、图层、删除。
- **批量修改属性**：多选同类图元（轨道 / 站台 / 文字 / 线）时，属性面板的修改批量应用到全部选中对象，一次撤销。
- 图层：新建、双击重命名、显示 / 隐藏、锁定 / 解锁、**删除任意图层**（含第一个 / 最后一个；文档可以没有图层，无图层对象仍正常渲染）。
- 隐藏图层不渲染；锁定图层不可选中 / 编辑。
- 当前活动图层用于新建轨道、站台与文字。

### 橡皮擦
- 工具栏 `E`（橡皮擦）：按住左键拖动，笔画经过的轨道 / 线段区间红色高亮（高亮即松手后删除的部分，边界取线路折点）；
- 松开后，轨道 / 线元素在笔画穿过的段区间处按折点切断（删除整段，两边保留为独立元素，新端点落在原折点上）；
- 站台、文字、方向标识直接删除；一次操作整体撤销。

### 批量布置
- 顶部工具栏“批量布置”弹出悬浮窗：每行一个元素（站台 / 线，`线线线` = 三条平行轨道），
  从上到下排列，在画布空白位置（当前视口中心）一次生成站台与轨道组，一次撤销。

### 命令与持久化
- Command Pattern：`CommandManager.execute / undo / redo`。
- 至少支持撤销 / 重做：新建轨道 / 线、新建站台 / 文字、删除对象、删除点、橡皮擦、批量布置、移动控制点、移动站台 / 文字、修改属性、创建道岔。
- 文件菜单：新建项目、打开项目、保存 / 导出 JSON。
- JSON 校验解析，加载失败有错误提示。
- LocalStorage 自动保存：文档变更 500ms debounce 后保存，刷新自动恢复。
- 状态栏保存状态：`保存中...` → `已保存`。

### 示例项目
首次打开自动加载“示例南京南站铁路枢纽配线图”，包含：
- 京沪高铁 / 宁杭高铁双线；
- 8 条站场股道；
- 4 条 45° 联络线；
- 4 个站台（夹在两组股道之间）；
- “示例南站”“京沪高铁”“宁杭高铁”等文字标注。

---

## 5. 项目目录说明

```text
src/
├── components/editor/        Vue UI 组件
│   ├── EditorCanvas.vue      Canvas 挂载与尺寸容器
│   ├── Toolbar.vue           左侧工具栏（选择 / 轨道 / 道岔 / 线 / 橡皮擦 / 站台 / 文字）
│   ├── TopBar.vue            顶部菜单、网格 / 吸附开关、批量布置入口
│   ├── PropertyPanel.vue     右侧属性面板（含批量修改）
│   ├── LayerPanel.vue        右侧图层面板（任意图层可删除）
│   ├── StatusBar.vue         底部坐标 / 缩放 / 保存状态
│   ├── LabelInputDialog.vue  文字输入对话框
│   ├── BatchLayoutDialog.vue 批量布置站台线路悬浮窗
│   └── ContextMenu.vue       右键菜单
├── editor/
│   ├── core/                 Editor Core（不依赖 Vue）
│   │   ├── Editor.ts         核心门面：文档、相机、命令、渲染调度、键盘
│   │   ├── Camera.ts         世界坐标 / 屏幕坐标变换与缩放
│   │   └── EditorState.ts    工具、选择（含控制点选择）等核心状态
│   ├── model/                结构化文档模型（不依赖 Canvas）
│   │   ├── Document.ts       文档工厂、类型守卫与 v1→v3 迁移
│   │   ├── DemoDocument.ts   首次启动示例枢纽图
│   │   ├── Track.ts / Node.ts / RailwayNode.ts / Platform.ts / Label.ts / Line.ts / Layer.ts / BaseElement.ts
│   ├── render/               Canvas 渲染器（不依赖 Pinia）
│   │   ├── Renderer.ts       渲染调度（含对齐参考线 / 橡皮擦预览）
│   │   ├── GridRenderer.ts   无限网格
│   │   ├── TrackRenderer.ts  单双线轨道渲染（中心线双线偏移算法）
│   │   ├── LineRenderer.ts   箭头 / 虚线元素渲染
│   │   ├── PlatformRenderer.ts / LabelRenderer.ts / NodeRenderer.ts / CrossingRenderer.ts / DirectionMarkerRenderer.ts
│   │   └── SelectionRenderer.ts 选中高亮、控制点、选中点、吸附提示
│   ├── interaction/
│   │   ├── PointerController.ts  统一指针事件路由
│   │   ├── PanController.ts      Space / 中键平移
│   │   ├── SelectionController.ts 选择、站台草稿
│   │   ├── DrawTrackController.ts 连续折线绘制（双击防抖 / Esc 取消 / 按工具提交）
│   │   ├── SwitchController.ts   道岔：主线锚点 + 连续绘制岔线
│   │   ├── EraserController.ts   橡皮擦笔画
│   │   ├── DragController.ts     控制点（含批量点）与图元拖动
│   │   ├── NodeController.ts     节点编辑
│   │   └── SegmentController.ts  段编辑
│   ├── geometry/
│   │   ├── Point.ts / Segment.ts / Polyline.ts / Transform.ts
│   │   ├── HitTest.ts        几何命中测试
│   │   ├── Snap.ts           网格 / 点 / 线路吸附
│   │   ├── Alignment.ts      虚拟对齐（参考线检测）
│   │   └── angle.ts          铁路八方向角度吸附
│   ├── commands/
│   │   ├── Command.ts / CommandManager.ts / CompositeCommand.ts
│   │   ├── AddTrackCommand.ts / AddElementCommand.ts / DeleteElementCommand.ts
│   │   ├── DeletePointCommand.ts / EraserCommand.ts
│   │   ├── MovePointCommand.ts / UpdateElementCommand.ts
│   │   └── TopologyCommands.ts（InsertVertex / AddVertexLink / MergeNodes / SplitNode / …）
│   ├── topology/Topology.ts  节点连接、vertexLinks、拆线 / 切割（橡皮擦）
│   ├── serialization/serializer.ts  项目 JSON 校验与解析
│   └── editorFactory.ts
├── stores/editor.ts          Pinia：文档、工具、选择、保存状态等 UI 投影
├── types/index.ts            领域类型定义
└── styles/main.scss          全局 UI 样式
```

---

## 6. 架构原则

1. **结构化对象优先**：Canvas 只是 `RailDocument` 的渲染结果，Bitmap 永不作为源数据。
2. **Editor Core 不依赖 Vue**：`Editor / Camera / Renderer / Geometry / Interaction / Commands` 均为普通 TypeScript 类。
3. **Renderer 不依赖 Pinia**：渲染器直接读取 Editor 持有的 Document。
4. **Document Model 不依赖 Canvas**：模型只包含纯数据。
5. **高频数据不进 Vue reactive**：pointermove 坐标、绘制预览、吸附点等保存在 Editor 内部；Pinia 只保存当前工具、选择 id、保存状态、鼠标世界坐标（状态栏显示）等低频 UI 状态。
6. **命令驱动修改**：撤销 / 重做不依赖整份 JSON 快照；每个可撤销操作实现 `execute / undo`。
7. **坐标纪律**：禁止直接把 Canvas pixel 坐标作为对象坐标。

---

## 7. 双线轨道偏移算法说明

Track 数据中只保存**中心 Polyline**。渲染双线时：

1. 对中心线每个内部顶点，取相邻两段单位法线的平均方向并归一化；
2. 端点使用所在线段法线；
3. 左右轨分别按 `± spacing / 2` 偏移；
4. 端点处补横向端帽，形成类似 `══` 的闭合双线端面。

折线转角使用 `round join` + 法线平均，避免锐角处产生明显尖刺。第一版不处理极端自交情况。

---

## 8. 第二 / 三阶段新增功能说明

- 道岔：不拆主线，主线保持连贯；岔线连续绘制折线；switch 节点通过 `vertexLinks` 连接。
- 平行轨道：数量 / 间距 / 左右侧 / 两侧居中；独立 Track，可分别连接道岔。
- 交叉：默认只是几何交叉；右键可连接、断开或设置跨线桥。
- 节点合并：节点模式拖动吸附合并，拓扑双向引用同步。
- 节点拆分：右键拆分节点，勾选保留轨道。
- 段平移：S 模式，水平 / 垂直 / 45° 段沿法向约束移动。
- 方向标识：线路端点方向名称，自动跟随端点切向；文字翻转保持可读。
- Hover：Node → Control Point → Segment → Element → Intersection 优先级。
- 多选：Ctrl/Cmd + 点击切换选中；空白处拖拽框选；Ctrl + 框选追加选择。
- 批量移动：多选后拖动任一已选图元，整体平移，一次 Undo / Redo。
- 跨线桥：下层仅视觉断口；断口宽度为下层线路属性，可修改且新画线路继承最近值；下层被选中或悬停时自动恢复完整线条。
- **图层可删除至零**：任意图层（含第一个 / 最后一个）可删除，文档可以没有图层。
- **双击防抖**：双击结束绘制不会多画出一段线；**Esc 取消整条草稿，Enter 直接结束提交**。
- **箭头 / 虚线元素**：`G` 工具连续画折线，属性面板设置虚线、起点 / 终点 / 两端箭头。
- **虚拟对齐**：吸附开启时自动识别水平 / 垂直 / 延长线对齐；优先级最高，对齐线满足后尽量再满足角度与网格。
- **点选择**：轨道 / 线顶点可单独选中、拖动、删除、批量移动。
- **批量改属性**：多选同类图元可批量修改属性，一次撤销。
- **橡皮擦**：按住拖动，红色高亮的段区间松手后按折点边界删除；站台 / 文字直接删除。
- **批量布置**：悬浮窗按行生成站台与线路组。
- **线路标注文字**：轨道属性设置标注文字，自动在线路旁创建文字框。
- **方向标识可定制**：字号、箭头大小、线宽（粗细）、正向 / 反向箭头；文字可隐藏。
- **拖动轨道不留孤立端点**：独占端点节点与道岔节点随轨道移动，共享节点自动断开。
- **交叉点 / 节点右键设为道岔**：不拆线，交点处两条线共用 switch 节点。

## 9. 尚未实现 / 阶段限制

- 无后端、登录、多人协作、WebSocket、CRDT。
- 无 GIS / 地图 / 真实铁路数据接入。
- 无复杂道岔、信号机、接触网、坡度、里程标等专业图元。
- 控制点拖动暂不强制 45° 约束传播。
- 双线偏移不处理极端自交曲线（第一阶段要求内）。
- 无 PDF 导出、无 A* 路由 / 自动布局 / 图像识别 / AI。
- 图层删除后对象移动到剩余图层，无图层时对象为“无图层”状态（仍渲染）。
- 橡皮擦切割后落在被删区间的 vertexLinks 会随重建清理（拓扑结构以切割边界为准）。
- 站台与文字创建走独立命令，属性修改命令不合并连续输入。

## 10. 文档 JSON 结构示例

```json
{
  "id": "uuid",
  "name": "示例南京南站铁路枢纽配线图",
  "version": 3,
  "canvas": { "width": 2600, "height": 2320, "gridSize": 20 },
  "layers": [
    { "id": "layer-uuid", "name": "默认图层", "visible": true, "locked": false }
  ],
  "nodes": [
    {
      "id": "node-a",
      "x": 440,
      "y": 260,
      "nodeType": "switch",
      "connectedTrackIds": ["track-uuid", "branch-uuid"],
      "vertexLinks": [{ "trackId": "track-uuid", "vertexIndex": 2 }]
    }
  ],
  "crossings": [],
  "elements": [
    {
      "id": "track-uuid",
      "type": "track",
      "layerId": "layer-uuid",
      "visible": true,
      "locked": false,
      "name": "京沪高铁",
      "points": [{ "x": 440, "y": 260 }, { "x": 2160, "y": 260 }],
      "trackStyle": "double",
      "strokeWidth": 4,
      "spacing": 16,
      "color": "#1f2933",
      "cornerRadius": 0,
      "bridgeGap": 20,
      "startNodeId": "node-start",
      "endNodeId": "node-end",
      "labelText": "京沪高铁",
      "labelId": "label-uuid"
    },
    {
      "id": "line-uuid",
      "type": "line",
      "layerId": "layer-uuid",
      "visible": true,
      "locked": false,
      "points": [{ "x": 100, "y": 100 }, { "x": 300, "y": 100 }],
      "dashed": true,
      "arrowStart": false,
      "arrowEnd": true,
      "color": "#475569",
      "strokeWidth": 2
    },
    {
      "id": "platform-uuid",
      "type": "platform",
      "layerId": "layer-uuid",
      "visible": true,
      "locked": false,
      "label": "1 站台",
      "start": { "x": 620, "y": 760 },
      "end": { "x": 1940, "y": 760 },
      "width": 18,
      "color": "#f8fafc",
      "textColor": "#475569"
    }
  ]
}
```

## 11. 协议与署名

本项目以 **Creative Commons Attribution-NonCommercial 4.0 International（CC BY-NC 4.0）** 协议开源，完整条款见仓库根目录 [LICENSE](LICENSE)。

- **署名（BY）**：转载、修改或再分发时，必须保留版权声明并明确标注原作者 **Shangru Li**，附上协议链接，说明是否做了修改。
- **非商业（NC）**：不得将本项目及其衍生作品用于商业目的（包括但不限于出售、付费服务、商业产品内嵌、广告变现）。
- 如需商业授权或有任何疑问，请联系作者。

版权所有 © 2026 Shangru Li。


## 12. 联系方式

作者：Shangru Li
邮箱：[lishangru@lishangru.cn](mailto:lishangru@lishangru.cn)
