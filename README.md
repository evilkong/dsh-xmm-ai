# dsh-xmm-workbuddy

把 DeepSeek Harness 中由 `dsh-connect-workbuddy` 接入的 WorkBuddy 模型，对外开放成 **OpenAI 兼容的 HTTP 接口**，并在 DSH 左侧菜单提供一个可视化配置页。

插件本身不直接连接 WorkBuddy：所有请求都通过 Harness 的 LLM 服务（`ctx.llm.stream`）转发，因此复用同一套已登录账号、积分池、模型目录与推理配置。

## 前置条件

- 已安装并启用 `dsh-connect-workbuddy`，且其中至少有一个区域（国内 `workbuddy` 或国际 `workbuddy-global`）已登录并可用。
- 本插件需要 WorkBuddy 模型：没有注册任何 WorkBuddy provider 时，接口会返回明确错误。

## 安装

### 方式一：通过插件管理器（推荐）

在 DSH 的「插件」页面选择「添加插件」，选中本插件目录即可。或使用命令行工具安装本目录。

### 方式二：解压到本地目录

把本压缩包解压到一个固定目录（不要用临时目录），然后在插件管理器中「添加插件」指向该目录。

## 配置界面

配置页有两个入口，内容完全相同：

1. **左侧菜单**：**小咪OpenAI兼容接口**，点击后在主区域直接显示配置表单。
2. **设置 → 小咪OpenAI兼容接口**：在 DSH 设置里也有独立分区入口，同样打开这份配置表单。

两个入口都无需弹窗、无需额外点击：

| 配置项 | 说明 |
|---|---|
| 接口地址 | 包含 `v1` 前缀的完整 `base_url`，可直接复制到 OpenAI SDK；旁边有复制按钮。 |
| 启用接口 | 关闭后所有 API 路由返回 503，配置页仍可访问。 |
| 路径前缀 | OpenAI 路由前缀，默认 `/v1`；其后自动接 `/models` 与 `/chat/completions`。改前缀不影响旧路径。 |
| API Key 列表 | 可自由增减多行，每行一个 Key，并可为每个 Key 填写备注（如「手机」「服务器 A」）。每个 Key 都能用 `Authorization: Bearer <key>` 调用。全部留空表示不鉴权。支持「＋添加 Key」「🎲生成」随机 Key 和「✕删除」单行。 |
| 默认区域 | `cn`（国内）或 `global`（国际），用于未加区域前缀的模型 id。 |
| 允许远程客户端 | 默认关闭（仅本机回环访问）。开启后接受来自网络的请求，请只在可信网络启用。 |
| 固定端口 | 填一个端口（如 `18080`）让插件另外监听该端口，接口地址固定不变；填 `0` 则关闭，使用宿主端口。 |
| 在左侧菜单显示入口 | 关闭后左侧菜单不再显示本插件入口；设置入口和固定端口接口不受影响。保存后即时生效。 |

配置页标题下方的说明为：**配置由插件dsh-connect-workbuddy提供服务的 OpenAI 兼容接口**。

配置通过 Harness 的配置编辑器保存，立即生效（固定端口需要重启应用后监听）。左侧菜单开关通过「注册/撤销菜单行」实现，是持久化的；DSH 自带的图钉 pin 是纯内存、重启即失效，不使用它作为开关。

### 关于监听端口

DSH 桌面版启动时硬编码传 `--port 0`，所以宿主 Web 服务每次启动都会随机换端口，而且命令行参数优先于 profile 配置——无法从配置层面固定它。

为此插件提供**固定端口**选项：设置一个端口号后，插件会自己用 Node 的 `http` 模块在该端口上监听，直接提供 OpenAI 接口。它复用宿主的 LLM 服务（`ctx.llm`）与附件服务（`ctx.attachments`），所以仍然走 WorkBuddy 已登录账号、积分池和模型目录，行为与宿主路由上的接口完全一致。

- 固定端口服务的路径是 `<前缀>/models`、`<前缀>/chat/completions` 和 `/health`，例如 `http://127.0.0.1:18080/v1/models`。
- 设置固定端口后，配置页顶部的「接口地址」会立即显示为这个固定地址。
- 绑定地址由「允许远程客户端」决定：关闭时只绑 `127.0.0.1`（仅本机）；开启时绑 `0.0.0.0`（所有网卡），局域网设备可通过 `http://<本机局域网IP>:<固定端口>/v1` 访问。绑定在监听时确定，改该项后插件重启即按新设置重新监听。
- 固定端口服务不受宿主端口变化影响。
- 固定端口被占用时会在插件日志里给出告警，接口仍可通过宿主路由访问。

## 接口

以当前宿主地址（配置页显示，例如 `http://127.0.0.1:60369`）为基准：

- `GET /plugins/dsh-xmm-workbuddy/<前缀>/models` — OpenAI 风格模型列表（`{"object":"list","data":[...]}`）。
- `POST /plugins/dsh-xmm-workbuddy/<前缀>/chat/completions` — 聊天补全。
  支持 `model`、`messages`、`stream`、`temperature`、`max_tokens` / `max_completion_tokens`、`stop`、`reasoning_effort`、`tools`。
  `stream: true` 返回 `text/event-stream`，以 `data: [DONE]` 结束。
- `GET /plugins/dsh-xmm-workbuddy/health` — 健康检查与可用 provider。

模型 id 默认按「配置区域优先、另一个区域兜底」解析；想指定区域可用 `workbuddy/<模型id>`（国内）或 `workbuddy-global/<模型id>`（国际）。

## 用 OpenAI SDK 调用

把 `base_url` 设到 `<宿主地址>/plugins/dsh-xmm-workbuddy/v1`（注意结尾是 `/v1`，SDK 会自己补 `/models`、`/chat/completions`）：

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:60369/plugins/dsh-xmm-workbuddy/v1",
    api_key="xmm-workbuddy-local",  # 与配置页里的某个 Key 一致
)

resp = client.chat.completions.create(
    model="hy4flash-free",
    messages=[{"role": "user", "content": "你好"}],
)
print(resp.choices[0].message.content)
```

## 看图（视觉模型）

支持标准 OpenAI `image_url` 内容块，流式与非流式都可用。接受 `data:image/png;base64,...`（也支持 jpeg/webp/gif）以及 `http(s)` 图片 URL；图片字节会通过 Harness 附件服务保存后作为真实图片送给模型。

```python
resp = client.chat.completions.create(
    model="hy4std",
    messages=[{"role": "user", "content": [
        {"type": "text", "text": "图里是什么颜色？"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}},
    ]}],
)
```

- 若宿主未挂载附件服务，图片请求会返回明确的 400 错误，而不是静默丢弃图片。
- 极小尺寸、纯色图片的颜色判断可能不稳定，这是模型本身的能力限制；正常照片/截图不受影响。

## 兼容性说明

已验证：模型列表、聊天补全、流式输出、system 消息、多轮对话、`stop` 序列、token 统计、图片输入、工具调用（取决于模型是否发起）。

注意：

- `image_url` 之外的图片扩展字段不保证支持。
- 推理内容通过 `reasoning_content` 字段返回（这是对 OpenAI 结构的扩展）。
- 配置/诊断路由（`/__config`、`/__save`、`/__status`）仅接受本机回环调用，避免密钥从网络泄露。

## 文件组成

- `index.js` — 宿主端：OpenAI 路由、配置读写、图片接入。
- `client.js` — 浏览器端：左侧菜单入口与配置页。
- `cordis.patch.yml` — DSH Loader 插入行。
- `locale/zh.json`、`locale/en.json` — 插件显示名称与描述。
- `icon.svg` — 插件图标。
- `README.md` — 本文档。

源码目录由后台自动同步监控：任何文件变更都会在数秒内自动重新打包并推送到 Git 仓库的 `main` 分支。

源码与自动同步脚本位于默认工作区 `D:\dsh\default`。
