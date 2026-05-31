import os
import io
import numpy as np
import cv2
from PIL import Image
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import tensorflow as tf
import base64

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────────
# IMG_H = 200  →  height  →  array shape axis 1
# IMG_W = 190  →  width   →  array shape axis 2
# Model input shape: (None, 200, 190, 1)
#
# PIL  .resize((width, height)) → .resize((IMG_W, IMG_H)) = .resize((190, 200))
# cv2  .resize(img, (width, height)) → cv2.resize(img, (IMG_W, IMG_H)) = cv2.resize(img, (190, 200))
# Both produce arrays of shape (IMG_H, IMG_W) = (200, 190)  ✓
# ─────────────────────────────────────────────────────────────────────────────

MODEL_PATH  = "final_model.keras"
CLASS_NAMES = ["NonDemented", "VeryMildDemented", "MildDemented", "ModerateDemented"]

IMG_H = 200   # height — array axis 1
IMG_W = 190   # width  — array axis 2

# Force float32 globally to avoid gradient underflow with mixed_float16 models
tf.keras.mixed_precision.set_global_policy('float32')

app = Flask(__name__, static_folder="static")
CORS(app)

print("[INFO] Loading CNN model...")
model = tf.keras.models.load_model(MODEL_PATH)
print(f"[INFO] Model loaded. Input shape: {model.input_shape}")

# Rebuild a float32 copy of the model specifically for Grad-CAM.
print("[INFO] Rebuilding float32 model for Grad-CAM...")
_model_json = model.to_json()
_model_json = _model_json.replace('"mixed_float16"', '"float32"')
_model_json = _model_json.replace('"float16"',       '"float32"')
model_f32   = tf.keras.models.model_from_json(_model_json)
model_f32.set_weights(model.get_weights())
for layer in model_f32.layers:
    if isinstance(layer, tf.keras.layers.BatchNormalization):
        layer.trainable = False

n_bn = sum(1 for l in model_f32.layers if isinstance(l, tf.keras.layers.BatchNormalization))
n_do = sum(1 for l in model_f32.layers if isinstance(l, tf.keras.layers.Dropout))
print(f"[INFO] MC Dropout: {n_bn} BatchNorm frozen, {n_do} Dropout active")
print("[INFO] Float32 Grad-CAM model ready.")


# ─────────────────────────────────────────────────────────────────────────────
# PREPROCESSING
# ─────────────────────────────────────────────────────────────────────────────

def preprocess_image(image_bytes):
    """
    Receives raw image bytes and returns a (1, IMG_H, IMG_W, 1) float32 array
    normalised to [0, 1], with CLAHE contrast enhancement.
    """
    img_pil     = Image.open(io.BytesIO(image_bytes)).convert("L")
    img_np      = np.array(img_pil, dtype=np.uint8)
    clahe       = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    img_clahe   = clahe.apply(img_np)
    img_resized = Image.fromarray(img_clahe).resize((IMG_W, IMG_H), Image.LANCZOS)
    img_norm    = np.array(img_resized, dtype=np.float32) / 255.0
    img_ready   = img_norm[np.newaxis, :, :, np.newaxis]   # (1, 200, 190, 1)
    return img_ready


def array_to_b64(img_np_uint8, upscale=2):
    """
    Converts a uint8 grayscale or BGR numpy array to a base64 JPEG string.
    Upscales by factor for better display quality.
    """
    if upscale > 1:
        h, w = img_np_uint8.shape[:2]
        img_np_uint8 = cv2.resize(
            img_np_uint8, (w * upscale, h * upscale),
            interpolation=cv2.INTER_NEAREST
        )
    _, buffer = cv2.imencode('.jpg', img_np_uint8, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return base64.b64encode(buffer).decode('utf-8')


# ─────────────────────────────────────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/health")
def health():
    return jsonify({"status": "ok", "model_loaded": True})


@app.route("/predict", methods=["POST"])
def predict():
    if "file" not in request.files:
        return jsonify({"error": "No file received. Use the 'file' field."}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "Empty file."}), 400

    image_bytes = file.read()

    try:
        img_ready = preprocess_image(image_bytes)
    except Exception as e:
        return jsonify({"error": f"Image processing error: {str(e)}"}), 400

    probs_array     = model.predict(img_ready, verbose=0)[0]
    predicted_index = int(np.argmax(probs_array))
    predicted_class = CLASS_NAMES[predicted_index]

    probabilities = {
        name: round(float(prob), 6)
        for name, prob in zip(CLASS_NAMES, probs_array)
    }

    return jsonify({
        "predicted_class":  predicted_class,
        "predicted_index":  predicted_index,
        "probabilities":    probabilities
    })


@app.route("/manifest.json")
def manifest():
    return send_from_directory(".", "manifest.json", mimetype="application/manifest+json")

@app.route("/sw.js")
def service_worker():
    return send_from_directory(".", "sw.js", mimetype="application/javascript")


# ─────────────────────────────────────────────────────────────────────────────
# PREPROCESSING PIPELINE ENDPOINT
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/preprocess", methods=["POST"])
def preprocess_pipeline():
    """
    Returns the 4 intermediate images produced during preprocessing,
    as base64 JPEGs, along with technical parameters.

    Steps:
      1. Grayscale conversion
      2. CLAHE enhancement  (clipLimit=2.0, tileGridSize=8×8)
      3. Resize to 190×200 px (LANCZOS)
      4. Normalisation [0, 1]  (visualised as uint8)
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "Empty file."}), 400

    image_bytes = file.read()

    try:
        # ── Step 1: Grayscale ────────────────────────────────────────────────
        img_pil      = Image.open(io.BytesIO(image_bytes)).convert("L")
        img_gray     = np.array(img_pil, dtype=np.uint8)
        orig_h, orig_w = img_gray.shape
        b64_gray     = array_to_b64(img_gray, upscale=1)

        # ── Step 2: CLAHE ────────────────────────────────────────────────────
        clahe        = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        img_clahe    = clahe.apply(img_gray)
        b64_clahe    = array_to_b64(img_clahe, upscale=1)

        # ── Step 3: Resize ───────────────────────────────────────────────────
        img_resized  = Image.fromarray(img_clahe).resize((IMG_W, IMG_H), Image.LANCZOS)
        img_res_np   = np.array(img_resized, dtype=np.uint8)
        b64_resized  = array_to_b64(img_res_np, upscale=2)

        # ── Step 4: Normalisation [0,1] — visualised ─────────────────────────
        img_norm_vis = np.uint8(img_res_np.astype(np.float32) / 255.0 * 255.0)
        b64_norm     = array_to_b64(img_norm_vis, upscale=2)

        # ── Histogram stats for CLAHE comparison ─────────────────────────────
        mean_before = round(float(np.mean(img_gray)),  2)
        std_before  = round(float(np.std(img_gray)),   2)
        mean_after  = round(float(np.mean(img_clahe)), 2)
        std_after   = round(float(np.std(img_clahe)),  2)

    except Exception as e:
        return jsonify({"error": f"Preprocessing error: {str(e)}"}), 400

    return jsonify({
        "steps": [
            {
                "id":    "grayscale",
                "label": "1 · Grayscale",
                "desc":  "RGB → single-channel luminance. Removes colour information irrelevant to MRI tissue contrast.",
                "image": f"data:image/jpeg;base64,{b64_gray}",
                "params": {
                    "Original size": f"{orig_w} × {orig_h} px",
                    "Channels":      "1 (grayscale)",
                    "Dtype":         "uint8  [0 – 255]"
                }
            },
            {
                "id":    "clahe",
                "label": "2 · CLAHE",
                "desc":  "Contrast Limited Adaptive Histogram Equalisation enhances local contrast without over-amplifying noise.",
                "image": f"data:image/jpeg;base64,{b64_clahe}",
                "params": {
                    "clipLimit":    "2.0",
                    "tileGridSize": "8 × 8",
                    "Mean before":  f"{mean_before}",
                    "Mean after":   f"{mean_after}",
                    "Std before":   f"{std_before}",
                    "Std after":    f"{std_after}"
                }
            },
            {
                "id":    "resize",
                "label": "3 · Resize",
                "desc":  "Resampled to the model's fixed input resolution using LANCZOS interpolation to preserve edge detail.",
                "image": f"data:image/jpeg;base64,{b64_resized}",
                "params": {
                    "Target size":     f"{IMG_W} × {IMG_H} px",
                    "Interpolation":   "LANCZOS",
                    "Aspect ratio":    "not preserved (fixed crop)"
                }
            },
            {
                "id":    "normalised",
                "label": "4 · Normalisation",
                "desc":  "Pixel values scaled from [0, 255] to [0, 1]. The array is then reshaped to (1, 200, 190, 1) before CNN inference.",
                "image": f"data:image/jpeg;base64,{b64_norm}",
                "params": {
                    "Range":         "[0.0 – 1.0]",
                    "Dtype":         "float32",
                    "Final shape":   f"(1, {IMG_H}, {IMG_W}, 1)",
                    "Total pixels":  f"{IMG_H * IMG_W:,}"
                }
            }
        ]
    })


# ─────────────────────────────────────────────────────────────────────────────
# GRAD-CAM HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def get_last_conv_layer(model_ref):
    for layer in reversed(model_ref.layers):
        if isinstance(layer, tf.keras.layers.Conv2D):
            return layer.name
    return None


def make_gradcam_heatmap(img_array, last_conv_layer_name, pred_index):
    """
    Computes a Grad-CAM heatmap using model_f32 (float32 copy).
    img_array shape: (1, IMG_H, IMG_W, 1) = (1, 200, 190, 1)
    Returns: heatmap np.float32 of shape (h_conv, w_conv), normalised [0, 1]
    """
    grad_model = tf.keras.models.Model(
        inputs  = model_f32.inputs,
        outputs = [model_f32.get_layer(last_conv_layer_name).output, model_f32.output]
    )

    img_tensor = tf.cast(img_array, tf.float32)

    with tf.GradientTape() as tape:
        tape.watch(img_tensor)
        conv_outputs, predictions = grad_model(img_tensor, training=False)
        loss = predictions[:, pred_index]

    grads = tape.gradient(loss, conv_outputs)
    if grads is None:
        return np.zeros((conv_outputs.shape[1], conv_outputs.shape[2]))

    pooled_grads = tf.reduce_mean(grads, axis=(0, 1, 2))
    heatmap      = conv_outputs[0] @ pooled_grads[..., tf.newaxis]
    heatmap      = tf.squeeze(heatmap)
    heatmap      = tf.maximum(heatmap, 0)
    max_val      = tf.math.reduce_max(heatmap)
    if max_val > 0:
        heatmap = heatmap / max_val
    return heatmap.numpy()


# ─────────────────────────────────────────────────────────────────────────────
# GRAD-CAM ENDPOINT
# ─────────────────────────────────────────────────────────────────────────────

@app.route('/gradcam', methods=['POST'])
def gradcam():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file      = request.files['file']
    img_bytes = file.read()

    try:
        img_array = preprocess_image(img_bytes)
    except Exception as e:
        return jsonify({'error': f'Image processing error: {str(e)}'}), 400

    preds      = model.predict(img_array, verbose=0)
    pred_index = int(np.argmax(preds[0]))

    last_conv = get_last_conv_layer(model_f32)
    if last_conv is None:
        return jsonify({'error': 'No Conv2D layer found in model'}), 500

    heatmap = make_gradcam_heatmap(img_array, last_conv, pred_index)
    heatmap = np.float32(heatmap)

    heatmap_resized = cv2.resize(heatmap, (IMG_W, IMG_H))
    heatmap_uint8   = np.uint8(255 * heatmap_resized)
    heatmap_colored = cv2.applyColorMap(heatmap_uint8, cv2.COLORMAP_JET)

    img_display = np.uint8(img_array[0, :, :, 0] * 255)
    img_bgr     = cv2.cvtColor(img_display, cv2.COLOR_GRAY2BGR)

    overlay     = cv2.addWeighted(img_bgr, 0.55, heatmap_colored, 0.45, 0)
    overlay_big = cv2.resize(overlay, (IMG_W * 2, IMG_H * 2), interpolation=cv2.INTER_CUBIC)

    _, buffer = cv2.imencode('.jpg', overlay_big, [cv2.IMWRITE_JPEG_QUALITY, 92])
    img_b64   = base64.b64encode(buffer).decode('utf-8')

    return jsonify({
        'gradcam_image': f'data:image/jpeg;base64,{img_b64}',
        'predicted_index': pred_index
    })


# ─────────────────────────────────────────────────────────────────────────────
# MC DROPOUT ENDPOINT
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/mcdropout", methods=["POST"])
def mcdropout():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "Empty file."}), 400
    try:
        img_ready = preprocess_image(file.read())
    except Exception as e:
        return jsonify({"error": f"Image processing error: {str(e)}"}), 400

    mc_preds = np.zeros((30, 4), dtype=np.float32)
    for s in range(30):
        mc_preds[s] = model_f32(img_ready, training=True).numpy()[0]

    mc_mean  = np.mean(mc_preds, axis=0)
    mc_std   = np.std(mc_preds,  axis=0)
    entropy  = float(-np.sum(mc_mean * np.log(mc_mean + 1e-8)))
    mean_unc = float(np.mean(mc_std))

    if   entropy < 0.3: level = "low"
    elif entropy < 0.7: level = "medium"
    else:               level = "high"

    return jsonify({
        "mc_mean":           dict(zip(CLASS_NAMES, mc_mean.tolist())),
        "mc_std":            dict(zip(CLASS_NAMES, mc_std.tolist())),
        "entropy":           round(entropy, 4),
        "mean_uncertainty":  round(mean_unc, 4),
        "uncertainty_level": level
    })


# ─────────────────────────────────────────────────────────────────────────────
# START SERVER
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    app.run(host="0.0.0.0", port=port, debug=False)