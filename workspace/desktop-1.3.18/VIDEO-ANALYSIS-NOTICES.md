# 视频分析组件

内置 Python 3.12.10（PSF 许可证，见 python/LICENSE.txt）、faster-whisper（MIT）、CTranslate2（MIT）、PyAV（BSD）、RapidOCR（Apache-2.0）、ONNX Runtime（MIT）、OpenCC（Apache-2.0）。各 Python wheel 的原始许可证保存在对应 dist-info 目录中。

ASR 模型：Systran/faster-whisper-small，基于 OpenAI Whisper small（MIT）。模型下载来源 https://huggingface.co/Systran/faster-whisper-small 。只用于本地转写；不使用该模型执行视觉推理。

人脸定位模型：OpenCV Zoo face_detection_yunet_2023mar.onnx（MIT），用于截取人物画面，来源 https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet 。

声音一致性核对：Sherpa-ONNX 2.0.1（Apache-2.0）与 WeSpeaker VoxCeleb ResNet34-LM（模型 CC-BY-4.0）。来源、署名和许可证见 models/speaker-embedding/。仅用于本集人物说话声的一致性比对，数值向量留在本机媒体缓存，不发送到个人 API 渠道。证据不足的身份或发声方式仍标记待复核。

本地媒体由 FFmpeg/PyAV 读取；视觉与剧本核对通过用户选择的个人 API 渠道执行。随包不包含个人 API Key 或验收用视频。
