# Video rePrompt

上传视频，自动识别每个镜头的画面内容和台词，生成可复用的提示词描述。

## 环境要求

- Node.js 18+
- Python 3.9+
- ffmpeg（需在 PATH 中，或通过环境变量指定路径）

## 安装

```bash
npm install
pip install -r requirements.txt
```

## 模型配置

默认使用阿里云 DashScope，你也可以切换到 OpenAI 兼容接口。

### 方式 A — 阿里云 DashScope（默认）

```bash
# Windows
set DASHSCOPE_API_KEY=sk-你的key

# macOS / Linux
export DASHSCOPE_API_KEY=sk-你的key
```

Key 获取：https://bailian.console.aliyun.com/

### 方式 B — OpenAI 兼容接口（Ollama / vLLM / OpenAI / Groq / 等）

```bash
# 视觉模型
set VISION_PROVIDER=openai
set VISION_BASE_URL=http://localhost:11434/v1
set VISION_API_KEY=ollama
set VISION_MODEL=llama3.2-vision

# 音频模型（Whisper API 兼容）
set AUDIO_PROVIDER=openai
set AUDIO_BASE_URL=http://localhost:8080/v1
set AUDIO_API_KEY=your-key
set AUDIO_MODEL=whisper-1
```

### 关闭音频分析

```bash
set AUDIO_PROVIDER=none
```

### 环境变量总览

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VISION_PROVIDER` | `dashscope` | 视觉模型服务商：`dashscope` 或 `openai` |
| `VISION_BASE_URL` | DashScope API | OpenAI 兼容接口地址 |
| `VISION_API_KEY` | （自动提取） | API Key |
| `VISION_MODEL` | `qwen-vl-max` | 模型名称 |
| `AUDIO_PROVIDER` | `dashscope` | 音频服务商：`dashscope` / `openai` / `none` |
| `AUDIO_BASE_URL` | DashScope API | 音频 API 地址 |
| `AUDIO_API_KEY` | （自动提取） | API Key |
| `AUDIO_MODEL` | `qwen-audio-turbo-latest` | 音频模型名称 |
| `PORT` | `3000` | 服务器端口 |
| `FFMPEG_PATH` | `ffmpeg` | ffmpeg 路径 |
| `FFPROBE_PATH` | `ffprobe` | ffprobe 路径 |
| `PYTHON_PATH` | `python` | Python 解释器路径 |

## 启动

```bash
npm start
```

浏览器打开 `http://localhost:3000`。

如果想改端口：
```bash
# Windows
set PORT=8080 && npm start

# macOS / Linux
PORT=8080 npm start
```

## 使用

1. 打开页面，选择 **上传文件**（拖拽或点击）或 **粘贴链接**（直链 mp4）
2. 设置「最多分析镜头数」，数量越多耗时越长
3. 等待处理完成，页面会显示每个镜头的时间线
4. 点击「导出为文件」下载 Markdown 格式的分析报告

## 自定义路径

如果 ffmpeg / Python 不在默认 PATH，可通过环境变量指定：

```
FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
FFPROBE_PATH=C:\ffmpeg\bin\ffprobe.exe
PYTHON_PATH=C:\Python39\python.exe
```

## 工作流

| 环节 | 方式 | 说明 |
|------|:--:|------|
| 视频上传 / 下载 | 本地 | Express multer / HTTP 直链下载 |
| 镜头检测 | 本地 | PySceneDetect 分析画面切换点 |
| 视频时长 | 本地 | ffprobe 读取元数据 |
| 画面帧抽取 | 本地 | ffmpeg 按时间戳截取 JPEG |
| 音频提取 | 本地 | ffmpeg 分离音轨，按镜头切片 |
| 画面分析 | API（可换） | 通过 VISION_PROVIDER 切换服务商 |
| 台词识别 | API（可换） | 通过 AUDIO_PROVIDER 切换服务商 |
| 界面 / 导出 | 本地 | 浏览器端渲染，导出 Markdown |

## 项目结构

```
├── server.js                 # Express 入口 + 启动检查
├── routes/analyze.js         # POST /api/analyze, GET /api/jobs/:id, GET /api/frames/:id/:idx
├── services/
│   ├── pipeline.js           # 编排器：detect → extract → describe
│   ├── sceneDetect.js        # PySceneDetect 封装 + ffmpeg scdet + 均匀采样三级降级
│   ├── frameExtract.js       # ffmpeg JPEG 抽帧
│   ├── audioExtract.js       # ffmpeg MP3 分离 + 按镜头切片
│   ├── audioDescribe.js      # 千问音频模型语音转写
│   ├── visionDescribe.js     # 千问视觉模型画面描述
│   └── downloadVideo.js      # HTTP 下载 + 平台识别 + 内容校验
├── utils/
│   ├── config.js             # 配置常量 + API Key 自动提取
│   └── cleanup.js            # 定时清理过期任务 (1h TTL)
├── public/
│   ├── index.html            # 前端界面
│   ├── css/style.css         # 样式
│   └── js/app.js             # 上传 / 轮询 / 时间线 / 导出
├── package.json              # npm 依赖
└── requirements.txt          # pip 依赖
```
