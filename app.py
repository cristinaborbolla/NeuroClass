import os
import io
import numpy as np
import cv2
from PIL import Image
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import tensorflow as tf

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
    
# Start server 
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    app.run(host="0.0.0.0", port=port, debug=False)