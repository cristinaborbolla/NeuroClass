# NeuroClass — CNN-Based Alzheimer's Disease Staging from Brain MRI Images

> Final Degree Project (TFG) · Biomedical Engineering · Universidad de Deusto · 2025–2026  
> Supervised by Prof. Begoña García-Zapirain · Co-supervised by Dr. Marcin Derlatka (Bialystok University of Technology)

---

## Overview

NeuroClass is a clinical web application for automated Alzheimer's disease staging from brain MRI images. It combines a high-performance convolutional neural network (CNN) with explainability tools and a Progressive Web App (PWA) interface designed for clinical use by both patients and medical professionals.

The system classifies MRI scans into four stages: **Non-Demented**, **Very Mild Demented**, **Mild Demented**, and **Moderate Demented**, achieving **98.9% test accuracy** and a macro AUC of **0.9997**.

---

## Features

- MRI upload and automated 4-class Alzheimer staging
- Grad-CAM saliency maps for prediction explainability
- Monte Carlo Dropout uncertainty quantification
- Role-based access: patients and doctors (staff code required)
- Doctor dashboard with longitudinal patient tracking
- Six cognitive assessment games with performance visualization (Chart.js)
- Personalized recommendation engine
- PDF report generation (jsPDF)
- MRI and Grad-CAM image storage (Supabase Storage, with patient consent)
- CSV data export
- Virtual assistant
- PWA-ready: installable on mobile and desktop

---

## Architecture

```
Frontend (PWA)          Backend (Flask API)         Infrastructure
--------------          -------------------         --------------
HTML / CSS / JS    ->   /predict endpoint      ->   Hugging Face Spaces (Docker)
manifest.json           /gradcam endpoint           Supabase (PostgreSQL + Auth + Storage)
service-worker.js       final_model.keras*
```

> *Model weights are hosted on Hugging Face Spaces and are not included in this repository due to file size constraints.

---

## CNN Model

Six custom CNN configurations were trained and evaluated (Advanced / Reduced / Minimal backbones x Dense-256 / Dense-64 heads) using the [Kaggle Augmented Alzheimer MRI Dataset](https://www.kaggle.com/datasets/uraninjo/augmented-alzheimer-mri-dataset).

| Model | Test Accuracy | Macro AUC |
|---|---|---|
| Advanced + Dense-64 (**best**) | **98.9%** | **0.9997** |
| Advanced + Dense-256 | 98.6% | 0.9995 |
| Reduced + Dense-64 | 97.8% | 0.9991 |

Hyperparameter optimization was performed with **Optuna TPE** (100 trials). Explainability was implemented via **Grad-CAM** and uncertainty via **Monte Carlo Dropout** (30-50 stochastic forward passes).

Additional experiments include a cross-domain evaluation (Kaggle + ADNI) and a **conditional DCGAN (cDCGAN)** for synthetic MRI generation (optimal checkpoint at epoch 475, FID 148.33, SSIM ~0.227).

---

## Repository Structure

```
NeuroClass/
├── app.py                  # Flask API (predict + gradcam endpoints)
├── requirements.txt
├── Dockerfile
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker
└── static/                 # Frontend (HTML, CSS, JS)
```

---

## Live Demo

The application backend is deployed on Hugging Face Spaces:  
https://huggingface.co/spaces/neuroclass/alzheimer-mri-classifier

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JS, Chart.js, jsPDF |
| Backend | Python, Flask, TensorFlow/Keras |
| Database | Supabase (PostgreSQL + Auth + Storage) |
| Deployment | Hugging Face Spaces (Docker), PWA |
| ML Training | TensorFlow, Optuna, NumPy, OpenCV |
| Explainability | Grad-CAM, Monte Carlo Dropout |
| Generative | cDCGAN (conditional DCGAN) |

---

## Running Locally

```bash
# Clone the repository
git clone https://github.com/cristinaborbolla/NeuroClass.git
cd NeuroClass

# Install dependencies
pip install -r requirements.txt

# Run the Flask API
python app.py
```

> You will need to provide your own `final_model.keras` weights file and configure Supabase credentials in a `.env` file.

---

## License

This project is licensed under the Apache 2.0 License. See [LICENSE](LICENSE) for details.

---

## Citation

If you use this work, please cite:

> Borbolla, C. (2026). *NeuroClass: CNN-Based Automated Alzheimer's Disease Staging from Brain MRI Images*. Final Degree Project, Biomedical Engineering, Universidad de Deusto.
