# 经典小游戏合集 · Classic Arcade

十个经典小游戏，全部**零依赖、零构建、纯前端**，双击 `index.html` 就能玩，
也可以直接丢到 GitLab Pages / GitHub Pages / 任意静态服务器上。

风格沿用另一个项目 arrow-maze 的霓虹极简：深色底 + 青绿高光，可一键切换白天纸感主题。

![大厅](./docs/shots/portal.png)

| 打砖块 | 推箱子 | 三消 |
| --- | --- | --- |
| ![打砖块](./docs/shots/breakout.png) | ![推箱子](./docs/shots/sokoban.png) | ![三消](./docs/shots/match3.png) |

## 游戏列表

| 分类 | 游戏 | 玩法 |
| --- | --- | --- |
| 街机动作 | 打砖块 Breakout | 挡板弹球打碎砖块，砖块有硬度，关卡无限 |
| 街机动作 | 太空侵略者 Invaders | 外星舰队整体推进，清空一波进下一波 |
| 街机动作 | 贪吃蛇 · 迷宫 Snake | 每关一张新迷宫，吃满目标长度过关 |
| 益智解谜 | 推箱子 Sokoban | 反向生成保证可解，只能推不能拉，支持撤销 |
| 益智解谜 | 一笔画 · 连线 Flow | 半自动生成，要求连线不交叉且铺满全盘 |
| 益智解谜 | 冰面滑行 Ice Slide | 一滑到底，撞石头才停，收集全部宝石 |
| 益智解谜 | 激光反射 Laser Mirror | 点击镜子旋转，把光束引到所有目标 |
| 休闲消除 | 扫雷 Minesweeper | 首点必安全，长按 / 右键插旗，限时闯关 |
| 休闲消除 | 2048 | 在步数用尽前合出目标方块 |
| 休闲消除 | 三消 Match 3 | 交换相邻方块，在步数内达到目标分 |

所有游戏都是**关卡制**：过关后进入下一关，难度逐级上升；
进度保存在 `localStorage`（键名前缀 `cg:`），大厅卡片上会显示「最高 第 N 关」。

## 本地运行

方式一：双击 `index.html`（全部是普通 `<script>`，不是 ES Module，`file://` 也能跑）。

方式二：起一个静态服务器（行为和线上一致）：

```bash
cd classic-games
npx serve .          # 或 python -m http.server 8080
```

## 目录结构

```
classic-games/
├── index.html               # 门户：分类筛选 + 卡片入口
├── assets/
│   ├── css/theme.css        # 双主题、卡片、HUD、弹层、工具栏
│   └── js/core.js           # 存储 / 主题 / 音效 / 弹层 / 画布适配 / 进度
├── games/
│   ├── breakout/index.html
│   ├── invaders/index.html
│   ├── snake/index.html
│   ├── sokoban/index.html
│   ├── flow/index.html
│   ├── ice/index.html
│   ├── lasers/index.html
│   ├── mines/index.html
│   ├── 2048/index.html
│   └── match3/index.html
├── tools/check.mjs          # 真浏览器自检：控制台报错 + 截图
└── .gitlab-ci.yml
```

单个游戏是完全自包含的一个 HTML 文件，只有共享样式和 `core.js` 是外部依赖，
复制走一个目录即可单独部署。

## 部署到 GitLab Pages

1. 在 GitLab 新建空仓库（例如 `classic-games`）。
2. 本地执行：

```bash
git init -b main
git add .
git commit -m "feat: classic arcade"
git remote add origin https://gitlab.com/<你的用户名>/classic-games.git
git push -u origin main
```

3. 仓库已带 `.gitlab-ci.yml`，推送后 **Build → Pipelines** 会自动跑 `pages` 任务，
   把 `index.html`、`assets/`、`games/` 拷进 `public/` 作为站点产物。
4. 流水线绿了之后在 **Deploy → Pages** 拿到地址，形如：

```text
https://<你的用户名>.gitlab.io/classic-games/
```

所有路径都是相对路径（`./assets/...`、`../../assets/...`），
所以放在 `/classic-games/` 这种子路径下也能正常工作，不需要改配置。

> GitLab 免费版 Pages 需要仓库为 public（或你有可用额度）；
> 首次部署后如果看到旧页面，按 `Ctrl + F5` 强刷。

## 技术要点

- **零依赖**：没有 npm 包、没有构建步骤；`core.js` 只是几十 KB 的普通脚本。
- **一套外壳**：`theme.css` 提供 HUD、工具栏、弹层、双主题；`core.js` 提供
  `CG.store` / `CG.theme` / `CG.sfx` / `CG.ui.modal` / `CG.util.grid` / `CG.progress`。
- **确定性关卡**：`CG.util.rng(seed)` 是 mulberry32，同一关卡重开布局一致。
- **可解性**：推箱子用「从已解状态反向拉箱子」生成，逆向序列即解法；
  一笔画先生成哈密顿路径再切段，保证存在铺满解；冰面滑行只在 BFS 可达的停靠点放宝石。
- **输入**：键盘（方向键 / WASD / 空格 / R / P）、鼠标、触屏滑动与长按都支持。

## 自检

```bash
node tools/check.mjs
```

会起一个本地静态服务器 + 无头 Chrome（DevTools 协议，不需要装 puppeteer），跑 44 项检查：

1. 门户 + 10 个游戏逐个打开：控制台零报错、canvas 真的画了东西；
2. 交互测试：点击发射、方向键移动、扫雷翻开、2048 滑动；
3. 通关测试：一笔画按生成器解法整条拖完必须过关、三消找出可消除的交换必须加分、
   激光转到解法朝向必须点亮全部目标；
4. 产出截图到 `docs/shots/`（含亮色主题和移动端布局）。

脚本里的端口是动态分配的，退出时会 `taskkill` 掉整棵 Chrome 进程树，不会留下后台进程。

> 调试钩子：`window.__flow` / `window.__match3` / `window.__lasers` / `window.__breakout`
> 暴露了各自的游戏状态对象，方便在控制台里查看和写自动化测试，不影响正常游玩。

