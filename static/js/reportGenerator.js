/**
 * NeuroClass — reportGenerator.js
 * Generates a clinical PDF report and uploads it to Supabase Storage.
 *
 * Dependencies (load via CDN before this module):
 *   jsPDF 2.5.x  →  https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
 *
 * Usage:
 *   import { generateAndUploadReport } from './reportGenerator.js';
 *   const result = await generateAndUploadReport({ patient, doctor, prediction,
 *                    gradcamBase64, gameScores, predictionId, supabase });
 *   // result → { success: true, reportUrl: '...', filename: '...' }
 *            or  { success: false, error: ... }
 */

// ─── Palette (mirrors NeuroStage CSS variables) ─────────────────────────────
const C = {
  primary:    [100, 140, 107],   // matcha green
  primaryDark:[72,  105,  80],
  secondary:  [188, 143, 143],   // dusty rose
  dark:       [38,   50,  56],
  mid:        [90,  110, 118],
  light:      [245, 248, 245],
  lightGray:  [220, 228, 222],
  white:      [255, 255, 255],
  // Stage severity
  stageNone:  [72,  187, 120],
  stageVMild: [246, 173,  85],
  stageMild:  [237, 137,  54],
  stageMod:   [214,  61,  61],
};

// ─── Stage metadata ──────────────────────────────────────────────────────────
const STAGES = {
  NonDemented: {
    label: 'Non-Demented',
    short: 'ND',
    color: C.stageNone,
    desc: 'No clinically significant signs of cognitive decline were detected.',
  },
  VeryMildDemented: {
    label: 'Very Mild Demented',
    short: 'VMD',
    color: C.stageVMild,
    desc: 'Very early indicators of cognitive impairment. Continued monitoring recommended.',
  },
  MildDemented: {
    label: 'Mild Demented',
    short: 'MD',
    color: C.stageMild,
    desc: 'Mild cognitive impairment identified. Clinical follow-up and neurological assessment advised.',
  },
  ModerateDemented: {
    label: 'Moderate Demented',
    short: 'MOD',
    color: C.stageMod,
    desc: 'Moderate cognitive impairment identified. Immediate clinical evaluation strongly recommended.',
  },
};

const STAGE_ORDER = ['NonDemented', 'VeryMildDemented', 'MildDemented', 'ModerateDemented'];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function hex(arr) { return arr; } // jsPDF accepts RGB arrays directly

function clamp(val, min = 0, max = 1) { return Math.min(max, Math.max(min, val)); }

function formatDate(d = new Date()) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(d = new Date()) {
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── PDF builder ─────────────────────────────────────────────────────────────
async function generateAndUploadReport({
  patient,       // { id, name, dni, dob }
  doctor,        // { id, name, dni }
  prediction,    // { stage: string, confidence: 0–1, allConfidences: { NonDemented: 0–1, ... } }
  gradcamBase64, // string | null  (data URL or raw base64)
  gameScores,    // [{ gameName, score, duration }] | null
  predictionId,  // UUID string
  supabase,      // Supabase client instance
}) {
  if (!window.jspdf) throw new Error('jsPDF not loaded. Add the CDN <script> before this module.');

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const PW = 210, PH = 297;
  const M  = 18;          // left/right margin
  const CW = PW - M * 2;  // content width
  let   y  = M;

  // ── Drawing utilities ──────────────────────────────────────────────────────
  const fill   = (c) => doc.setFillColor(...c);
  const stroke = (c) => doc.setDrawColor(...c);
  const text   = (c) => doc.setTextColor(...c);

  const rect = (x, yy, w, h, c, r = 0, mode = 'F') => {
    fill(c);
    r > 0 ? doc.roundedRect(x, yy, w, h, r, r, mode) : doc.rect(x, yy, w, h, mode);
  };

  const line = (x1, y1, x2, y2, c = C.lightGray, lw = 0.3) => {
    doc.setLineWidth(lw);
    stroke(c);
    doc.line(x1, y1, x2, y2);
  };

  const label = (str, x, yy, size = 7, style = 'normal', align = 'left') => {
    doc.setFontSize(size);
    doc.setFont('helvetica', style);
    doc.text(str, x, yy, { align });
  };

  // ── HEADER BAR ────────────────────────────────────────────────────────────
  rect(0, 0, PW, 30, C.primary);

  // Logo circle
  fill(C.white);
  doc.circle(M + 9, 15, 9, 'F');
  text(C.primary);
  label('N', M + 6.5, 13.5, 9, 'bold');
  label('S', M + 9.5, 19,   6, 'bold');

  // App name + subtitle
  text(C.white);
  label('NeuroStage', M + 22, 12, 16, 'bold');
  label('Clinical Prediction Report', M + 22, 19, 8, 'normal');

  // Report metadata (top-right)
  text([200, 230, 205]);
  label(`Report ID: ${predictionId}`,          PW - M, 10, 6.5, 'normal', 'right');
  label(`Generated: ${formatDateTime()}`,       PW - M, 16, 6.5, 'normal', 'right');
  label(`Date of assessment: ${formatDate()}`,  PW - M, 22, 6.5, 'normal', 'right');

  y = 38;

  // ── PATIENT + PHYSICIAN INFO CARDS ────────────────────────────────────────
  const cardH  = 28;
  const half   = (CW - 6) / 2;

  // Left card: patient
  rect(M, y, half, cardH, C.light, 3);
  text(C.mid);
  label('PATIENT', M + 5, y + 7, 6.5, 'bold');
  line(M + 5, y + 9, M + half - 5, y + 9, C.lightGray, 0.2);
  text(C.dark);
  label(patient.name || '—',              M + 5, y + 15, 9,   'bold');
  text(C.mid);
  label(`DNI  ${patient.dni || '—'}`,     M + 5, y + 21, 7.5, 'normal');
  label(`DOB  ${patient.dob || '—'}`,     M + 5, y + 26, 7.5, 'normal');

  // Right card: physician
  const x2 = M + half + 6;
  rect(x2, y, half, cardH, C.light, 3);
  text(C.mid);
  label('PHYSICIAN', x2 + 5, y + 7, 6.5, 'bold');
  line(x2 + 5, y + 9, x2 + half - 5, y + 9, C.lightGray, 0.2);
  text(C.dark);
  label(doctor.name || '—',              x2 + 5, y + 15, 9,   'bold');
  text(C.mid);
  label(`ID    ${doctor.dni || '—'}`,    x2 + 5, y + 21, 7.5, 'normal');
  label(`Date  ${formatDate()}`,         x2 + 5, y + 26, 7.5, 'normal');

  y += cardH + 8;

  // ── STAGING RESULT BADGE ──────────────────────────────────────────────────
  const stage      = STAGES[prediction.stage] ?? STAGES.NonDemented;
  const confidence = clamp(prediction.confidence ?? 0);
  const confStr    = `${(confidence * 100).toFixed(1)}%`;

  rect(M, y, CW, 24, stage.color, 4);

  // Short stage code badge (left accent)
  fill([0, 0, 0, 0.15]);
  doc.roundedRect(M + 4, y + 4, 14, 16, 2, 2, 'F');
  text(C.white);
  label(stage.short, M + 11, y + 15, 8, 'bold', 'center');

  // Stage label + description
  text(C.white);
  label('DIAGNOSIS STAGE', M + 22, y + 9,  6.5, 'bold');
  label(stage.label,       M + 22, y + 17, 13,  'bold');

  // Confidence (right)
  label(confStr,     PW - M - 5, y + 12, 18, 'bold', 'right');
  text([255, 255, 255, 0.8]);
  label('confidence', PW - M - 5, y + 19, 7,  'normal', 'right');

  y += 24 + 4;

  // Description
  text(C.mid);
  label(stage.desc, M, y + 5, 7.5, 'italic');
  y += 11;

  // ── SECTION: CONFIDENCE BREAKDOWN ────────────────────────────────────────
  line(M, y, PW - M, y, C.lightGray, 0.4);
  y += 5;

  text(C.dark);
  label('Classification Confidence Breakdown', M, y, 8.5, 'bold');
  y += 6;

  const allConf  = prediction.allConfidences ?? {};
  const labelCol = 42;
  const barStart = M + labelCol;
  const barTotal = CW - labelCol - 18;
  const rowH     = 9;
  const stageColors = [C.stageNone, C.stageVMild, C.stageMild, C.stageMod];

  STAGE_ORDER.forEach((s, i) => {
    const val    = clamp(allConf[s] ?? (s === prediction.stage ? confidence : 0));
    const barW   = barTotal * val;
    const isMain = s === prediction.stage;

    // Row background on selected stage
    if (isMain) rect(M - 1, y - 1, CW + 2, rowH, [245, 249, 245], 2);

    text(isMain ? C.dark : C.mid);
    doc.setFont('helvetica', isMain ? 'bold' : 'normal');
    doc.setFontSize(7.5);
    doc.text(STAGES[s].label, M, y + 5.5);

    // Background track
    rect(barStart, y + 1, barTotal, 5, C.lightGray, 2);
    // Value fill
    if (barW > 0.5) rect(barStart, y + 1, barW, 5, stageColors[i], 2);

    // Percentage
    text(isMain ? C.dark : C.mid);
    doc.setFont('helvetica', isMain ? 'bold' : 'normal');
    doc.setFontSize(7.5);
    doc.text(`${(val * 100).toFixed(1)}%`, PW - M, y + 5.5, { align: 'right' });

    y += rowH;
  });

  y += 5;

  // ── SECTION: GRAD-CAM ────────────────────────────────────────────────────
  if (gradcamBase64) {
    line(M, y, PW - M, y, C.lightGray, 0.4);
    y += 5;
    text(C.dark);
    label('Grad-CAM Activation Map', M, y, 8.5, 'bold');
    y += 5;

    try {
      const imgSrc = gradcamBase64.startsWith('data:') ? gradcamBase64 : `data:image/png;base64,${gradcamBase64}`;
      const imgW   = 58;
      const imgH   = 58;

      // Border frame
      doc.setLineWidth(0.5);
      stroke(C.lightGray);
      doc.rect(M - 0.5, y - 0.5, imgW + 1, imgH + 1);
      doc.addImage(imgSrc, 'PNG', M, y, imgW, imgH);

      // Annotation text beside image
      const tx = M + imgW + 7;
      const tw = CW - imgW - 7;

      text(C.mid);
      label('Layer: conv2d_7', tx, y + 8, 7, 'normal');
      label(`Class: ${stage.label}`, tx, y + 15, 7, 'normal');
      label(`Confidence: ${confStr}`, tx, y + 22, 7, 'normal');

      const cap = 'Gradient-weighted Class Activation Map highlighting brain regions that most influenced the model\'s prediction. Warmer colors indicate higher activation.';
      doc.setFontSize(7);
      doc.setFont('helvetica', 'italic');
      text(C.mid);
      const capLines = doc.splitTextToSize(cap, tw);
      doc.text(capLines, tx, y + 32);

      y += imgH + 6;
    } catch (e) {
      console.warn('[NeuroStage] Grad-CAM embed failed:', e);
      text(C.mid);
      label('(Grad-CAM image unavailable)', M, y + 5, 7, 'italic');
      y += 10;
    }
  }

  // ── SECTION: COGNITIVE GAMES ─────────────────────────────────────────────
  if (gameScores && gameScores.length > 0) {
    line(M, y, PW - M, y, C.lightGray, 0.4);
    y += 5;
    text(C.dark);
    label('Cognitive Assessment — Game Scores', M, y, 8.5, 'bold');
    y += 5;

    // Table header
    const col = [CW * 0.50, CW * 0.25, CW * 0.25];
    const tx  = [M, M + col[0], M + col[0] + col[1]];

    rect(M, y, CW, 7.5, C.primary, 2);
    text(C.white);
    label('Game',     tx[0] + 3, y + 5.2, 7.5, 'bold');
    label('Score',    tx[1] + 3, y + 5.2, 7.5, 'bold');
    label('Duration', tx[2] + 3, y + 5.2, 7.5, 'bold');
    y += 7.5;

    gameScores.forEach((g, i) => {
      const rowColor = i % 2 === 0 ? C.white : C.light;
      rect(M, y, CW, 7, rowColor);
      text(C.dark);
      label(g.gameName   ?? `Game ${i + 1}`,  tx[0] + 3, y + 5, 7.5, 'normal');
      label(String(g.score ?? '—'),            tx[1] + 3, y + 5, 7.5, 'normal');
      label(g.duration ? `${g.duration} s` : '—', tx[2] + 3, y + 5, 7.5, 'normal');
      y += 7;
    });

    y += 4;
  }

  // ── CLINICAL NOTES (blank) ────────────────────────────────────────────────
  if (y < PH - 60) {
    line(M, y, PW - M, y, C.lightGray, 0.4);
    y += 5;
    text(C.dark);
    label('Clinical Notes', M, y, 8.5, 'bold');
    y += 5;
    rect(M, y, CW, 22, C.light, 2);
    text(C.lightGray);
    label('(To be completed by attending physician)', M + 5, y + 12, 7, 'italic');
    y += 26;
  }

  // ── FOOTER ───────────────────────────────────────────────────────────────
  const FY = PH - 18;
  line(M, FY - 3, PW - M, FY - 3, C.lightGray, 0.3);

  // Left: branding
  text(C.mid);
  label('NeuroStage  ·  Universidad de Deusto  ·  Bilbao, Spain', M, FY + 2, 6.5, 'normal');

  // Right: page
  label('Page 1 of 1', PW - M, FY + 2, 6.5, 'normal', 'right');

  // Disclaimer
  text([160, 172, 165]);
  const disc = 'DISCLAIMER: This report is generated automatically by NeuroStage for clinical support purposes only. It does not constitute a medical diagnosis and must be interpreted by a qualified healthcare professional in conjunction with clinical assessment. Results are based on a deep learning model and may not reflect the full clinical picture.';
  const discLines = doc.splitTextToSize(disc, CW);
  doc.setFontSize(5.8);
  doc.setFont('helvetica', 'italic');
  doc.text(discLines, M, FY + 7);

  // ── DOWNLOAD ─────────────────────────────────────────────────────────────
  const dateStr  = new Date().toISOString().slice(0, 10);
  const filename = `NeuroStage_${patient.dni}_${dateStr}_${predictionId.slice(0, 8)}.pdf`;
  doc.save(filename);

  // ── UPLOAD TO SUPABASE STORAGE ────────────────────────────────────────────
  const pdfBlob     = doc.output('blob');
  const storagePath = `${patient.id}/${predictionId}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from('neuro-reports')
    .upload(storagePath, pdfBlob, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (uploadError) {
    console.error('[NeuroStage] Report upload error:', uploadError);
    return { success: false, error: uploadError };
  }

  // Signed URL valid for 1 year (365 × 24 × 3600 s)
  const { data: signedData, error: urlError } = await supabase.storage
    .from('neuro-reports')
    .createSignedUrl(storagePath, 31_536_000);

  if (urlError) {
    console.error('[NeuroStage] Signed URL error:', urlError);
    return { success: false, error: urlError };
  }

  return { success: true, reportUrl: signedData.signedUrl, filename };
}
async function generateEvolutionReport({ patient, doctor, predictions, supabase }) {
  if (!window.jspdf) throw new Error('jsPDF no está cargado.');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const PW = 210, PH = 297, M = 18, CW = 210 - 18 * 2;
  let y = M;

  const fill  = (c) => doc.setFillColor(...c);
  const tc    = (c) => doc.setTextColor(...c);
  const stroke= (c) => doc.setDrawColor(...c);
  const rct   = (x, yy, w, h, c, r = 0) => { fill(c); r > 0 ? doc.roundedRect(x, yy, w, h, r, r, 'F') : doc.rect(x, yy, w, h, 'F'); };
  const ln    = (x1, y1, x2, y2, lw = 0.25) => { doc.setLineWidth(lw); stroke([210, 225, 212]); doc.line(x1, y1, x2, y2); };
  const lbl   = (str, x, yy, size = 7, style = 'normal', align = 'left') => { doc.setFontSize(size); doc.setFont('helvetica', style); doc.text(str, x, yy, { align }); };

  const STAGE_META = {
    NonDemented:      { label: 'Non-Demented',      color: [72, 187, 120],  dot: [72, 187, 120]  },
    VeryMildDemented: { label: 'Very Mild Demented', color: [246, 173, 85],  dot: [246, 173, 85]  },
    MildDemented:     { label: 'Mild Demented',      color: [237, 137, 54],  dot: [237, 137, 54]  },
    ModerateDemented: { label: 'Moderate Demented',  color: [214, 61, 61],   dot: [214, 61, 61]   },
  };
  const STAGE_ORDER = ['NonDemented','VeryMildDemented','MildDemented','ModerateDemented'];

  const sorted = [...predictions].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  // ── HEADER ──────────────────────────────────────────────
  rct(0, 0, PW, 26, [245, 248, 245]);
  doc.setLineWidth(0.4); stroke([180, 214, 180]); doc.line(0, 26, PW, 26);
  tc([100, 140, 107]); lbl('NeuroStage', M, 11, 11, 'bold');
  tc([130, 160, 135]); lbl('Evolution Report', M, 18, 7.5);
  tc([90, 110, 95]);
  lbl('Patient: ' + (patient.name || '—'),             PW - M, 10, 7, 'normal', 'right');
  lbl('DNI: ' + (patient.dni || '—'),                  PW - M, 16, 6.5, 'normal', 'right');
  lbl('Generated: ' + new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }), PW - M, 22, 6.5, 'normal', 'right');

  y = 34;

  // ── PHYSICIAN ───────────────────────────────────────────
  tc([130, 155, 135]); lbl('Physician: ' + (doctor.name || '—') + '  ·  ' + (doctor.dni || '—'), M, y, 7);
  y += 8;

  // ── EVOLUTION SUMMARY ────────────────────────────────────
  ln(M, y, PW - M, y); y += 5;
  tc([38, 50, 56]); lbl('Staging evolution', M, y, 9, 'bold'); y += 6;

  if (sorted.length >= 2) {
    const first = STAGE_META[sorted[0].predicted_class];
    const last  = STAGE_META[sorted[sorted.length - 1].predicted_class];
    const fi    = STAGE_ORDER.indexOf(sorted[0].predicted_class);
    const li    = STAGE_ORDER.indexOf(sorted[sorted.length - 1].predicted_class);
    const trend = li > fi ? '↑ Worsening' : li < fi ? '↓ Improving' : '→ Stable';
    const trendColor = li > fi ? [214, 61, 61] : li < fi ? [72, 187, 120] : [180, 140, 60];

    rct(M, y, CW, 16, [248, 251, 248], 3);
    fill(first.dot); doc.circle(M + 8, y + 8, 3.5, 'F');
    tc([38, 50, 56]); lbl(first.label, M + 14, y + 6, 7.5, 'bold');
    tc([150, 170, 155]); lbl(new Date(sorted[0].created_at).toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'}), M + 14, y + 12, 6.5);

    tc([180, 200, 182]); lbl('→', PW/2, y + 9, 10, 'bold', 'center');

    fill(last.dot); doc.circle(PW - M - 55 + 8, y + 8, 3.5, 'F');
    tc([38, 50, 56]); lbl(last.label, PW - M - 55 + 14, y + 6, 7.5, 'bold');
    tc([150, 170, 155]); lbl(new Date(sorted[sorted.length-1].created_at).toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'}), PW - M - 55 + 14, y + 12, 6.5);

    tc(trendColor); lbl(trend, PW - M, y + 9, 8, 'bold', 'right');
    y += 22;
  }

  tc([150, 170, 155]); lbl(sorted.length + ' prediction' + (sorted.length !== 1 ? 's' : '') + ' recorded', M, y, 6.5);
  y += 8;

  // ── PREDICTIONS ──────────────────────────────────────────
  for (let i = 0; i < sorted.length; i++) {
    const r    = sorted[i];
    const meta = STAGE_META[r.predicted_class] || STAGE_META.NonDemented;
    const conf = (r.confidence * 100).toFixed(1);
    const dateStr = new Date(r.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });

    // Check page space
    const hasImages = !!(r.mri_url || r.gradcam_url);
    const blockH    = hasImages ? 80 : 46;
    if (y + blockH > PH - 22) {
      doc.addPage();
      y = M;
    }

    // Date header
    ln(M, y, PW - M, y); y += 4;
    fill(meta.dot); doc.circle(M + 2.5, y + 2.5, 2.5, 'F');
    tc([38, 50, 56]); lbl(dateStr, M + 8, y + 5, 8, 'bold');
    tc(meta.color); lbl(meta.label, M + 8, y + 11, 7);
    tc([90, 110, 95]); lbl(conf + '% confidence', PW - M, y + 8, 7.5, 'bold', 'right');
    y += 16;

    // Confidence bars
    const allConf = {
      NonDemented:      r.prob_non_demented,
      VeryMildDemented: r.prob_very_mild,
      MildDemented:     r.prob_mild,
      ModerateDemented: r.prob_moderate,
    };
    const labelCol = 38, barStart = M + labelCol, barTotal = CW - labelCol - 16, barH = 4;
    STAGE_ORDER.forEach((s, si) => {
      const val  = Math.min(1, Math.max(0, allConf[s] ?? 0));
      const barW = barTotal * val;
      doc.setFontSize(6); doc.setFont('helvetica', 'normal');
      tc([130, 150, 135]); doc.text(STAGE_META[s].label, M, y + barH - 0.5);
      fill([225, 235, 226]); doc.roundedRect(barStart, y, barTotal, barH, 1.5, 1.5, 'F');
      if (barW > 0.5) { fill(STAGE_META[s].dot); doc.roundedRect(barStart, y, barW, barH, 1.5, 1.5, 'F'); }
      tc([90, 110, 95]); doc.setFont('helvetica', s === r.predicted_class ? 'bold' : 'normal');
      doc.text((val * 100).toFixed(1) + '%', PW - M, y + barH - 0.5, { align: 'right' });
      y += 7;
    });

    // Images
    if (hasImages) {
      y += 2;
      const imgW = 55, imgH = 55;
      let imgX = M;

      if (r.mri_url) {
        try {
          const res  = await fetch(r.mri_url);
          const blob = await res.blob();
          const b64  = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });
          doc.setLineWidth(0.3); stroke([210, 225, 212]); doc.rect(imgX - 0.5, y - 0.5, imgW + 1, imgH + 1);
          doc.addImage(b64, 'JPEG', imgX, y, imgW, imgH);
          tc([150, 170, 155]); lbl('MRI', imgX + imgW / 2, y + imgH + 4, 6, 'normal', 'center');
          imgX += imgW + 6;
        } catch(e) { console.warn('MRI image load error:', e); }
      }

      if (r.gradcam_url) {
        try {
          const res  = await fetch(r.gradcam_url);
          const blob = await res.blob();
          const b64  = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });
          doc.setLineWidth(0.3); stroke([210, 225, 212]); doc.rect(imgX - 0.5, y - 0.5, imgW + 1, imgH + 1);
          doc.addImage(b64, 'JPEG', imgX, y, imgW, imgH);
          tc([150, 170, 155]); lbl('Grad-CAM', imgX + imgW / 2, y + imgH + 4, 6, 'normal', 'center');
        } catch(e) { console.warn('Grad-CAM image load error:', e); }
      }

      y += imgH + 10;
    } else {
      y += 4;
    }
  }

  // ── FOOTER ───────────────────────────────────────────────
  const FY = PH - 14;
  doc.setLineWidth(0.25); stroke([210, 225, 212]); doc.line(M, FY - 3, PW - M, FY - 3);
  tc([170, 190, 172]); lbl('NeuroStage  ·  Universidad de Deusto  ·  Clinical support only — not a medical diagnosis', M, FY + 2, 5.8, 'italic');

  // ── DESCARGAR ────────────────────────────────────────────
  const filename = 'NeuroStage_Evolution_' + patient.dni + '_' + new Date().toISOString().slice(0, 10) + '.pdf';
  doc.save(filename);
}