"""Model registry: lazy singleton loading on one GPU, health/status reporting."""

import threading

from ..core.config import settings


class ModelManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._pipe = None
        self._sheetsage = None
        self._mert = None
        self._demucs = None
        self._asr = None
        self._vae = None
        self._agent_llm = None
        self._full_vae = None

    @property
    def loaded(self) -> bool:
        return self._pipe is not None

    def pipeline(self):
        with self._lock:
            if self._pipe is None:
                import torch
                from yue2 import YuE2Pipeline

                if not torch.cuda.is_available():
                    raise RuntimeError("CUDA is not available; YuE2 requires a GPU")
                self._pipe = YuE2Pipeline.from_pretrained(
                    settings.yue2_repo, device=settings.device, progress=False
                )
            return self._pipe

    def sheetsage(self):
        with self._lock:
            if self._sheetsage is None:
                import torch
                from transformers import AutoModel

                device = settings.device if torch.cuda.is_available() else "cpu"
                self._sheetsage = (
                    AutoModel.from_pretrained(settings.sheetsage_repo, trust_remote_code=True)
                    .eval()
                    .to(device)
                )
            return self._sheetsage

    def mert(self):
        """Return (processor, model) for MERT-v2-FullSong feature extraction."""
        with self._lock:
            if self._mert is None:
                import torch
                from transformers import AutoFeatureExtractor, AutoModel

                device = settings.device if torch.cuda.is_available() else "cpu"
                processor = AutoFeatureExtractor.from_pretrained(
                    settings.mert_repo, trust_remote_code=True
                )
                model = (
                    AutoModel.from_pretrained(settings.mert_repo, trust_remote_code=True)
                    .eval()
                    .to(device)
                )
                self._mert = (processor, model)
            return self._mert

    def demucs(self):
        with self._lock:
            if self._demucs is None:
                import torch
                from demucs.pretrained import get_model

                model = get_model("htdemucs_ft")
                device = settings.device if torch.cuda.is_available() else "cpu"
                model.to(device)
                model.eval()
                self._demucs = model
            return self._demucs

    def asr(self):
        with self._lock:
            if self._asr is None:
                import torch
                from qwen_asr import Qwen3ASRModel

                device_map = "cuda:0" if settings.device == "cuda" else settings.device
                self._asr = Qwen3ASRModel.from_pretrained(
                    settings.asr_repo,
                    dtype=torch.bfloat16,
                    device_map=device_map,
                    max_new_tokens=1024,
                )
            return self._asr

    def vae(self):
        """Dedicated YuE2-Vae decoder for region audition / splicing (kept resident)."""
        with self._lock:
            if self._vae is None:
                import torch
                from yue2.modeling_vae import YuE2VAE

                device = settings.device if torch.cuda.is_available() else "cpu"
                self._vae = YuE2VAE.from_pretrained(
                    settings.yue2_vae_repo, decoder_only=True, device="cpu", local_files_only=True
                ).to(device)
            return self._vae

    def full_vae(self):
        """Full YuE2-Vae (encoder + decoder) for reconstruction metrics."""
        with self._lock:
            if self._full_vae is None:
                import torch
                from yue2.modeling_vae import YuE2VAE

                device = settings.device if torch.cuda.is_available() else "cpu"
                self._full_vae = YuE2VAE.from_pretrained(
                    settings.yue2_vae_repo, decoder_only=False, device="cpu", local_files_only=True
                ).to(device)
            return self._full_vae

    def agent_llm(self):
        """Small local LLM (Qwen3-0.6B) for the score-editing agent."""
        with self._lock:
            if self._agent_llm is None:
                import torch
                from transformers import AutoModelForCausalLM, AutoTokenizer

                device = settings.device if torch.cuda.is_available() else "cpu"
                tok = AutoTokenizer.from_pretrained(settings.agent_repo, trust_remote_code=True)
                model = (
                    AutoModelForCausalLM.from_pretrained(
                        settings.agent_repo, torch_dtype=torch.bfloat16, trust_remote_code=True
                    )
                    .eval()
                    .to(device)
                )
                self._agent_llm = (tok, model)
            return self._agent_llm

    def status(self) -> dict:
        info: dict = {
            "yue2": {"loaded": self.loaded, "repo": settings.yue2_repo},
            "sheetsage2": {"loaded": self._sheetsage is not None},
            "mert": {"loaded": self._mert is not None, "repo": settings.mert_repo},
            "htdemucs": {"loaded": self._demucs is not None},
            "qwen3-asr": {"loaded": self._asr is not None, "repo": settings.asr_repo},
            "vae": {"loaded": self._vae is not None},
            "agent_llm": {"loaded": self._agent_llm is not None, "repo": settings.agent_repo},
        }
        try:
            import torch

            if torch.cuda.is_available():
                free, total = torch.cuda.mem_get_info()
                info["gpu"] = {
                    "name": torch.cuda.get_device_name(0),
                    "free_gb": round(free / 2**30, 1),
                    "total_gb": round(total / 2**30, 1),
                }
        except Exception:
            pass
        return info

    def free_gpu(self, *keep) -> None:
        """Release models not listed in keep (names: yue2, sheetsage2, mert, htdemucs)."""
        import torch

        with self._lock:
            released = []
            if "yue2" not in keep and self._pipe is not None:
                self._pipe.close()
                self._pipe = None
                released.append("yue2")
            if "sheetsage2" not in keep and self._sheetsage is not None:
                self._sheetsage = None
                released.append("sheetsage2")
            if "mert" not in keep and self._mert is not None:
                self._mert = None
                released.append("mert")
            if "htdemucs" not in keep and self._demucs is not None:
                self._demucs = None
                released.append("htdemucs")
            if "asr" not in keep and self._asr is not None:
                self._asr = None
                released.append("qwen3-asr")
            if "vae" not in keep and self._vae is not None:
                self._vae = None
                released.append("vae")
            if "agent" not in keep and self._agent_llm is not None:
                self._agent_llm = None
                released.append("agent-llm")
            if released and torch.cuda.is_available():
                torch.cuda.empty_cache()
        if released:
            print("[models] released:", ", ".join(released), flush=True)


models = ModelManager()
