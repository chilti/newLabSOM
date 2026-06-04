import json
import sys

def detect_hardware():
    result = {
        "level": 3,
        "device": "CPU (Fallback Universal)",
        "details": "Traditional CPU computing"
    }
    
    # 1. Check Level 1: NVIDIA CUDA
    try:
        import torch
        if torch.cuda.is_available():
            # Check if cuML is available
            try:
                import cuml
                result["level"] = 1
                result["device"] = torch.cuda.get_device_name(0)
                result["details"] = "NVIDIA GPU with CUDA and RAPIDS (cuML) acceleration"
                return result
            except ImportError:
                # CUDA available but not cuML, we can still run Level 1 or 2
                result["level"] = 2
                result["device"] = torch.cuda.get_device_name(0)
                result["details"] = "NVIDIA GPU (CUDA) with PyTorch acceleration"
                return result
    except ImportError:
        pass

    # 2. Check Level 2: Apple Metal (MPS) or AMD/DirectML
    try:
        import torch
        # Check macOS Apple Silicon MPS (Metal Performance Shaders)
        if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
            result["level"] = 2
            result["device"] = "Apple Silicon GPU (MPS)"
            result["details"] = "macOS Metal Performance Shaders acceleration"
            return result
    except ImportError:
        pass
        
    try:
        # Check ONNX Runtime with DirectML/Vulkan if possible
        import onnxruntime as ort
        providers = ort.get_available_providers()
        if 'DmlExecutionProvider' in providers:
            result["level"] = 2
            result["device"] = "Windows DirectML GPU"
            result["details"] = "DirectML hardware acceleration"
            return result
        elif 'VulkanExecutionProvider' in providers:
            result["level"] = 2
            result["device"] = "Vulkan GPU"
            result["details"] = "Vulkan hardware acceleration"
            return result
    except ImportError:
        pass

    return result

if __name__ == "__main__":
    hw_info = detect_hardware()
    print(json.dumps(hw_info))
