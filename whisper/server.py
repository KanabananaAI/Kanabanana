import os
import tempfile

# Add NVIDIA pip-installed DLL paths to PATH so CTranslate2 can find cublas/cudnn
try:
    import nvidia.cublas
    import nvidia.cudnn
    for pkg in (nvidia.cublas, nvidia.cudnn):
        dll_dir = os.path.join(pkg.__path__[0], "bin")
        if os.path.isdir(dll_dir):
            os.environ["PATH"] = dll_dir + os.pathsep + os.environ.get("PATH", "")
except ImportError:
    pass

from fastapi import FastAPI, UploadFile, File
from faster_whisper import WhisperModel

app = FastAPI()

model_size = os.environ.get("WHISPER_MODEL", "base.en")
device = os.environ.get("WHISPER_DEVICE", "auto")


def load_model():
    if device == "cpu":
        print(f"Loading Whisper '{model_size}' on CPU (int8)...")
        return WhisperModel(model_size, device="cpu", compute_type="int8"), "cpu"

    # Try CUDA first, fall back to CPU
    try:
        print(f"Loading Whisper '{model_size}' on CUDA (float16)...")
        m = WhisperModel(model_size, device="cuda", compute_type="float16")
        print("Whisper loaded on CUDA.")
        return m, "cuda"
    except Exception as e:
        print(f"CUDA failed ({e}), falling back to CPU...")
        m = WhisperModel(model_size, device="cpu", compute_type="int8")
        print("Whisper loaded on CPU.")
        return m, "cpu"


model, active_device = load_model()


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    suffix = os.path.splitext(audio.filename or ".webm")[1] or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(await audio.read())
        tmp_path = f.name

    try:
        segments, _ = model.transcribe(tmp_path, beam_size=1, language="en")
        text = " ".join(s.text for s in segments).strip()
        return {"text": text}
    finally:
        try:
            os.unlink(tmp_path)
        except PermissionError:
            pass


@app.get("/health")
def health():
    return {"status": "ok", "model": model_size, "device": active_device}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=3002)
