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
export async function generateAndUploadReport({
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
