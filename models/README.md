# SnapText OCR 模型目录

SnapText 的桌面 OCR 流程要求 `models/` 目录包含 PP-OCRv6 multilingual 的四个文件：

- `det.onnx`
- `cls.onnx`
- `rec.onnx`
- `rec_dict.txt`

当前仓库不会把真实模型文件直接提交进版本库。仓库里保留这个目录，目的是让本地开发、打包和设置页校验都指向同一个固定位置。

## 目录要求

1. 四个文件必须位于 `models/` 根目录。
2. `rec_dict.txt` 不能为空。
3. 四个 ONNX 文件必须能被 `ort` 正常加载。
4. 正式发布必须同时提供 `manifest.json` 和 `SHA256SUMS`，用于固定本次交付的模型来源和资产版本。

## 安装方式

仓库提供 manifest 驱动的安装脚本，但不会内置未经确认的模型下载地址。先复制示例 manifest，并把四个文件的 URL 和 SHA-256 替换为本次发布选定的官方地址或内部镜像地址：

```bash
cp models/manifest.example.json models/manifest.json
```

然后运行：

```bash
python3 scripts/install_ocr_models.py --manifest models/manifest.json --model-dir models
```

该脚本会下载 `det.onnx`、`cls.onnx`、`rec.onnx` 和 `rec_dict.txt` 到临时目录，逐个校验 SHA-256；只有四个文件全部校验通过后才会安装到模型目录，写入 `models/SHA256SUMS`，保留本次使用的 `models/manifest.json`，再运行：

```bash
python3 scripts/verify_ocr_models.py --require-sha256 models
```

Manifest 的 `files` 对象只允许这四个固定文件名；如果包含额外条目，安装脚本会失败，避免正式发布误混入未审计模型资产。

如果需要覆盖已有模型文件，必须显式增加 `--force`。

## 校验方式

在桌面应用里可以通过设置页的 `Validate models` 按钮校验当前模型目录。它会检查：

- 是否缺少必要文件
- 识别字典是否为空
- ONNX session 是否能够正常加载

如果模型缺失或损坏，界面会直接返回可读错误，而不是等到实际截图/OCR 时才报错。

放入真实模型后，可以额外运行固定图片 smoke test：

```bash
SNAPTEXT_OCR_MODEL_DIR=models cargo test -p snaptext-core --test ocr_smoke -- --ignored --nocapture
```

该测试会生成一张包含 `SNAPTEXT` 的固定图片，并执行完整 `det -> cls -> rec` OCR 流程。它默认被标记为 `ignored`，因为仓库本身不携带真实模型文件。

发布前建议直接运行模型验收脚本：

```bash
python3 scripts/verify_ocr_models.py
```

该脚本会先检查四个必要文件和非空识别字典，再设置 `SNAPTEXT_OCR_MODEL_DIR` 并运行上面的 ignored smoke test。也可以显式传入模型目录：

```bash
python3 scripts/verify_ocr_models.py /path/to/pp-ocrv6-models
```

如果模型目录存在 `SHA256SUMS`，脚本会自动校验四个必要文件的 SHA-256。`SHA256SUMS` 格式使用常见的两列格式：

```text
<sha256>  det.onnx
<sha256>  cls.onnx
<sha256>  rec.onnx
<sha256>  rec_dict.txt
```

首次确认模型文件后，可以生成 `SHA256SUMS`：

```bash
python3 scripts/verify_ocr_models.py --write-sha256-manifest models
```

正式发布验收强制要求 `manifest.json` 和 `SHA256SUMS` 都存在，并且 `manifest.json` 中的 SHA-256 与 `SHA256SUMS` 和实际文件一致：

```bash
python3 scripts/verify_ocr_models.py --require-sha256 models
```

## 当前状态

仓库当前只保留目录占位符，没有附带真实模型文件。因此：

- OCR 代码路径已完成
- 模型资产校验门已完成
- 真实 OCR smoke test 已加入，但需要模型在位后显式运行
- `scripts/verify_ocr_models.py` 已加入，用于模型在位后的发布验收
- `scripts/verify_ocr_models.py` 已支持可选 `SHA256SUMS` 校验和发布强制校验模式；发布强制模式会同时校验 `manifest.json`、`SHA256SUMS` 和实际文件一致性
- `scripts/install_ocr_models.py` 已加入，用于从显式 manifest 下载、校验和安装模型文件
- 模型文件交付仍待外部放入
- 真实 OCR 端到端验证仍待执行
