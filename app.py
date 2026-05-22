import os
import io
import numpy as np
import cv2
from PIL import Image
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import tensorflow as tf
import base64

# Configuration
# Model file must be in the same directory as app.py
MODEL_PATH  = "final_model.keras"
CLASS_NAMES = ["NonDemented", "VeryMildDemented",
               "MildDemented", "ModerateDemented"]

IMG_H = 200   # height in pixels
IMG_W = 190   # width in pixels

app = Flask(__name__, static_folder="static")
CORS(app)

print("[INFO] Loading CNN model...")
model = tf.keras.models.load_model(MODEL_PATH)
print(f"[INFO] Model loaded. Input shape: {model.input_shape}")

# Preprocessing
def preprocess_image(image_bytes):
    img_pil     = Image.open(io.BytesIO(image_bytes)).convert("L")
    img_np      = np.array(img_pil, dtype=np.uint8)
    clahe       = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    img_clahe   = clahe.apply(img_np)
    img_resized = Image.fromarray(img_clahe).resize((IMG_W, IMG_H), Image.LANCZOS)
    img_norm    = np.array(img_resized, dtype=np.float32) / 255.0
    img_ready   = img_norm[np.newaxis, :, :, np.newaxis]
    return img_ready


# Routes
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

 
# ── Helpers ───────────────────────────────────────────────────
def get_last_conv_layer(model):
    for layer in reversed(model.layers):
        if isinstance(layer, tf.keras.layers.Conv2D):
            return layer.name
    return None
 
def make_gradcam_heatmap(img_array, model, last_conv_layer_name, pred_index):
    grad_model = tf.keras.models.Model(
        inputs  = model.inputs,
        outputs = [model.get_layer(last_conv_layer_name).output, model.output]
    )
    with tf.GradientTape() as tape:
        conv_outputs, predictions = grad_model(img_array)
        class_channel = predictions[:, pred_index]
 
    grads       = tape.gradient(class_channel, conv_outputs)
    pooled_grads= tf.reduce_mean(grads, axis=(0, 1, 2))
    heatmap     = conv_outputs[0] @ pooled_grads[..., tf.newaxis]
    heatmap     = tf.squeeze(heatmap)
    heatmap     = tf.maximum(heatmap, 0) / (tf.math.reduce_max(heatmap) + 1e-8)
    return heatmap.numpy()
 
# ── Endpoint /gradcam ─────────────────────────────────────────
@app.route('/gradcam', methods=['POST'])
def gradcam():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
 
    file     = request.files['file']
    img_bytes= file.read()
    np_arr   = np.frombuffer(img_bytes, np.uint8)
    img_gray = cv2.imdecode(np_arr, cv2.IMREAD_GRAYSCALE)
 
    if img_gray is None:
        return jsonify({'error': 'Could not decode image'}), 400
 
    # ── Preprocess (igual que en /predict) ────────────────────
    img_resized = cv2.resize(img_gray, (190, 200))   # (W, H) → 190x200
    clahe       = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    img_clahe   = clahe.apply(img_resized)
    img_norm    = img_clahe.astype(np.float32) / 255.0
    img_array   = np.expand_dims(img_norm, axis=(0, -1))   # (1, 190, 200, 1)
 
    # ── Predicción ────────────────────────────────────────────
    preds      = model.predict(img_array, verbose=0)
    pred_index = int(np.argmax(preds[0]))
 
    # ── Grad-CAM ──────────────────────────────────────────────
    last_conv = get_last_conv_layer(model)
    if last_conv is None:
        return jsonify({'error': 'No Conv2D layer found in model'}), 500
 
    heatmap         = make_gradcam_heatmap(img_array, model, last_conv, pred_index)
    heatmap = np.float32(heatmap)
    heatmap_resized = cv2.resize(heatmap, (190, 200))
    heatmap_uint8   = np.uint8(255 * heatmap_resized)
    heatmap_colored = cv2.applyColorMap(heatmap_uint8, cv2.COLORMAP_JET)
 
    # ── Overlay sobre imagen original ─────────────────────────
    img_bgr = cv2.cvtColor(img_resized, cv2.COLOR_GRAY2BGR)
    overlay = cv2.addWeighted(img_bgr, 0.55, heatmap_colored, 0.45, 0)
 
    # Upscale para que se vea bien en pantalla
    overlay_big = cv2.resize(overlay, (400, 380), interpolation=cv2.INTER_CUBIC)
 
    _, buffer    = cv2.imencode('.jpg', overlay_big, [cv2.IMWRITE_JPEG_QUALITY, 92])
    img_b64      = base64.b64encode(buffer).decode('utf-8')
 
    return jsonify({
        'gradcam_image': f'data:image/jpeg;base64,{img_b64}',
        'predicted_index': pred_index
    })
    
# Start server 
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    app.run(host="0.0.0.0", port=port, debug=False)