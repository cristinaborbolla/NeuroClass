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
# Expected: (None, 200, 190, 1)


# ─────────────────────────────────────────────────────────────────────────────
# PREPROCESSING
# ─────────────────────────────────────────────────────────────────────────────

def preprocess_image(image_bytes):
    """
    Receives raw image bytes and returns a (1, IMG_H, IMG_W, 1) float32 array
    normalised to [0, 1], with CLAHE contrast enhancement.
    PIL.resize((width, height)) → array shape (height, width) = (IMG_H, IMG_W) ✓
    """
    img_pil     = Image.open(io.BytesIO(image_bytes)).convert("L")
    img_np      = np.array(img_pil, dtype=np.uint8)
    clahe       = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    img_clahe   = clahe.apply(img_np)
    img_resized = Image.fromarray(img_clahe).resize((IMG_W, IMG_H), Image.LANCZOS)
    # PIL.resize((190, 200)) → array (200, 190) ✓
    img_norm    = np.array(img_resized, dtype=np.float32) / 255.0
    img_ready   = img_norm[np.newaxis, :, :, np.newaxis]   # (1, 200, 190, 1)
    return img_ready


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
        img_ready = preprocess_image(image_bytes)   # (1, 200, 190, 1)
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


# ─────────────────────────────────────────────────────────────────────────────
# GRAD-CAM HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def get_last_conv_layer(model):
    for layer in reversed(model.layers):
        if isinstance(layer, tf.keras.layers.Conv2D):
            return layer.name
    return None


def make_gradcam_heatmap(img_array, model, last_conv_layer_name, pred_index):
    """
    Computes a Grad-CAM heatmap for the given img_array and predicted class.
    img_array shape: (1, IMG_H, IMG_W, 1) = (1, 200, 190, 1)
    Returns: heatmap np.float32 of shape (h_conv, w_conv), normalised [0, 1]
    """
    grad_model = tf.keras.models.Model(
        inputs  = model.inputs,
        outputs = [model.get_layer(last_conv_layer_name).output, model.output]
    )

    img_tensor = tf.cast(img_array, tf.float32)   # (1, 200, 190, 1)

    with tf.GradientTape() as tape:
        tape.watch(img_tensor)
        conv_outputs, predictions = grad_model(img_tensor, training=False)
        # Cast to float32 to avoid underflow with mixed_float16
        conv_outputs_f32 = tf.cast(conv_outputs, tf.float32)
        predictions_f32  = tf.cast(predictions,  tf.float32)
        class_channel    = predictions_f32[:, pred_index]

    grads = tape.gradient(class_channel, conv_outputs)
    if grads is None:
        return np.zeros((conv_outputs.shape[1], conv_outputs.shape[2]))

    grads        = tf.cast(grads, tf.float32)
    pooled_grads = tf.reduce_mean(grads, axis=(0, 1, 2))
    heatmap      = conv_outputs_f32[0] @ pooled_grads[..., tf.newaxis]
    heatmap      = tf.squeeze(heatmap)
    heatmap      = tf.maximum(heatmap, 0) / (tf.math.reduce_max(heatmap) + 1e-8)
    return heatmap.numpy()   # (h_conv, w_conv)


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
        img_array = preprocess_image(img_bytes)   # (1, 200, 190, 1)
    except Exception as e:
        return jsonify({'error': f'Image processing error: {str(e)}'}), 400

    # Prediction
    preds      = model.predict(img_array, verbose=0)
    pred_index = int(np.argmax(preds[0]))

    # Grad-CAM
    last_conv = get_last_conv_layer(model)
    if last_conv is None:
        return jsonify({'error': 'No Conv2D layer found in model'}), 500

    heatmap = make_gradcam_heatmap(img_array, model, last_conv, pred_index)
    # heatmap shape: (h_conv, w_conv) — small spatial dims from last conv layer

    heatmap = np.float32(heatmap)

    # Resize heatmap to match model input: cv2.resize takes (width, height)
    # Target: (IMG_W, IMG_H) = (190, 200) → result array shape (200, 190) ✓
    heatmap_resized = cv2.resize(heatmap, (IMG_W, IMG_H))   # (190, 200) → array (200, 190)

    heatmap_uint8   = np.uint8(255 * heatmap_resized)       # (200, 190)
    heatmap_colored = cv2.applyColorMap(heatmap_uint8, cv2.COLORMAP_JET)  # (200, 190, 3)

    # Original image for overlay: img_array[0, :, :, 0] → shape (200, 190) ✓
    img_display = np.uint8(img_array[0, :, :, 0] * 255)    # (200, 190)
    img_bgr     = cv2.cvtColor(img_display, cv2.COLOR_GRAY2BGR)  # (200, 190, 3)

    overlay = cv2.addWeighted(img_bgr, 0.55, heatmap_colored, 0.45, 0)  # (200, 190, 3)

    # Upscale for display: cv2.resize takes (width, height)
    # Double the size: width=380, height=400 → array (400, 380, 3)
    overlay_big = cv2.resize(overlay, (IMG_W * 2, IMG_H * 2), interpolation=cv2.INTER_CUBIC)

    _, buffer = cv2.imencode('.jpg', overlay_big, [cv2.IMWRITE_JPEG_QUALITY, 92])
    img_b64   = base64.b64encode(buffer).decode('utf-8')

    return jsonify({
        'gradcam_image': f'data:image/jpeg;base64,{img_b64}',
        'predicted_index': pred_index
    })


# ─────────────────────────────────────────────────────────────────────────────
# START SERVER
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    app.run(host="0.0.0.0", port=port, debug=False)