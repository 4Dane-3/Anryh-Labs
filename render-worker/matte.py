"""The person cut out of the talking video, so graphics can sit behind their head.

Reads talk.mp4 and writes a grayscale mask video (white = person) of the same size and frame rate, which
render.mjs merges into a transparent person.webm. MediaPipe's multiclass selfie model (background, hair, body,
face, clothes, other), smoothed over time so the edge doesn't shimmer.

python3 matte.py <talk.mp4> <mask.mp4> <model.tflite> <ffmpeg>
"""
import subprocess
import sys

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import ImageSegmenter, ImageSegmenterOptions, RunningMode

src, dst, model, ffmpeg = sys.argv[1:5]
cap = cv2.VideoCapture(src)
fps = cap.get(cv2.CAP_PROP_FPS) or 30
w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

out = subprocess.Popen(
    [ffmpeg, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{w}x{h}", "-r", f"{fps}", "-i", "-",
     "-c:v", "libx264", "-preset", "fast", "-crf", "12", "-pix_fmt", "yuv420p", dst],
    stdin=subprocess.PIPE,
)
seg = ImageSegmenter.create_from_options(ImageSegmenterOptions(
    base_options=BaseOptions(model_asset_path=model),
    running_mode=RunningMode.VIDEO,
    output_confidence_masks=True,
))

prev = None
i = 0
while True:
    ok, frame = cap.read()
    if not ok:
        break
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    res = seg.segment_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(i * 1000 / fps))
    masks = res.confidence_masks
    # Category 0 is the background: the person is everything else
    person = 1.0 - masks[0].numpy_view().astype(np.float32) if len(masks) > 1 else masks[0].numpy_view().astype(np.float32)
    person = cv2.resize(person, (w, h), interpolation=cv2.INTER_LINEAR)
    # Firm up the edge (a soft model edge reads as a halo), then a light blur so it isn't jagged
    person = np.clip((person - 0.35) / 0.3, 0, 1)
    person = cv2.GaussianBlur(person, (0, 0), 1.6)
    # Temporal smoothing: most of this frame, a little of the last
    prev = person if prev is None else 0.7 * person + 0.3 * prev
    out.stdin.write((prev * 255).astype(np.uint8).tobytes())
    i += 1

out.stdin.close()
out.wait()
cap.release()
print(f"matte: {i} frames at {w}x{h}")
