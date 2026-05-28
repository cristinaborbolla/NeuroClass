/**
 * NeuroClass — reportGenerator.js
 * Individual prediction report + evolution report.
 * Requires jsPDF loaded via CDN before this script.
 */

// ─── Palette ─────────────────────────────────────────────────
const _NC = {
  matcha:    [148, 180, 159],
  matchaDk:  [100, 140, 107],
  matchaLt:  [210, 230, 215],
  cream:     [250, 248, 242],
  creamDk:   [236, 231, 216],
  dark:      [44,  62,  48],
  mid:       [100, 128, 108],
  muted:     [150, 170, 155],
  light:     [245, 249, 245],
  border:    [183, 214, 176],
  white:     [255, 255, 255],
  stageNone: [116, 176, 133],
  stageVMild:[224, 177, 99],
  stageMild: [227, 129, 77],
  stageMod:  [212, 89,  89],
  blue:      [48,  80, 176],
};

const _STAGE = {
  NonDemented:      { label:'Non-Demented',       short:'ND',  color:_NC.stageNone,  idx:0 },
  VeryMildDemented: { label:'Very Mild Demented',  short:'VMD', color:_NC.stageVMild, idx:1 },
  MildDemented:     { label:'Mild Demented',        short:'MD',  color:_NC.stageMild,  idx:2 },
  ModerateDemented: { label:'Moderate Demented',    short:'MOD', color:_NC.stageMod,   idx:3 },
};
const _ORDER = ['NonDemented','VeryMildDemented','MildDemented','ModerateDemented'];

const _DOMAINS = [
  { key:'memory',       label:'Visual Memory',        game:'Memory'        },
  { key:'orientation',  label:'Temporal Orientation', game:'Orientation'   },
  { key:'sequence',     label:'Working Memory',       game:'Sequence'      },
  { key:'whatsmissing', label:'Visual Attention',     game:"What's Missing"},
  { key:'pattern',      label:'Visuospatial Memory',  game:'Pattern'       },
  { key:'arithmetic',   label:'Numerical Reasoning',  game:'Arithmetic'    },
];

function _fmt(d)   { return new Date(d||Date.now()).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }
function _fmtDT(d) { return new Date(d||Date.now()).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); }
function _clamp(v) { return Math.min(1,Math.max(0,v||0)); }

// ─── Compute domain trends from game sessions ─────────────────
function _computeDomains(sessions) {
  if (!sessions || sessions.length === 0) return null;
  const result = {};
  _DOMAINS.forEach(d => {
    const gameSessions = sessions
      .filter(s => s.game_name === d.key)
      .sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
    if (gameSessions.length === 0) { result[d.key] = null; return; }
    const scores = gameSessions.map(s => (s.score / s.max_score) * 100);
    const latest = scores[scores.length - 1];
    let trend = 'stable';
    if (scores.length >= 2) {
      const mid   = Math.floor(scores.length / 2);
      const first = scores.slice(0, mid).reduce((a,b)=>a+b,0) / mid;
      const last  = scores.slice(mid).reduce((a,b)=>a+b,0) / (scores.length - mid);
      if (last - first > 8)  trend = 'improving';
      if (first - last > 8)  trend = 'declining';
    }
    result[d.key] = { trend, latest: Math.round(latest), sessions: gameSessions.length };
  });
  return result;
}

// ─── PDF factory ─────────────────────────────────────────────
function _makePDF() {
  if (!window.jspdf) throw new Error('jsPDF not loaded.');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
  const PW=210, PH=297, M=18, CW=174;

  const fill   = (c) => doc.setFillColor(...c);
  const tc     = (c) => doc.setTextColor(...c);
  const sk     = (c,lw=0.3) => { doc.setDrawColor(...c); doc.setLineWidth(lw); };
  const rct    = (x,y,w,h,c,r=0) => { fill(c); r>0 ? doc.roundedRect(x,y,w,h,r,r,'F') : doc.rect(x,y,w,h,'F'); };
  const hline  = (y,col=_NC.border,lw=0.25) => { sk(col,lw); doc.line(M,y,M+CW,y); };
  const t      = (s,x,y,sz=7,st='normal',al='left',col=_NC.dark) => {
    doc.setFontSize(sz); doc.setFont('helvetica',st); tc(col); doc.text(s,x,y,{align:al});
  };
  const serif  = (s,x,y,sz=11,al='left',col=_NC.dark) => {
    doc.setFontSize(sz); doc.setFont('times','bold'); tc(col); doc.text(s,x,y,{align:al});
  };

  return { doc, PW, PH, M, CW, fill, tc, sk, rct, hline, t, serif };
}

// ─── Page header ─────────────────────────────────────────────
function _pageHeader(p, doc, PW, M, CW, rct, hline, t, serif, subtitle) {
  // Top accent line
  rct(0,0,PW,2,_NC.matchaDk);
  // Header background
  rct(0,2,PW,30,_NC.light);
  hline(32,_NC.border,0.3);

  // Logo
  rct(M,7,12,12,_NC.matchaDk,2);
  t('NC',M+1.5,16,7,'bold','left',_NC.white);

  // Title
  serif('NeuroClass',M+16,13,12,'left',_NC.matchaDk);
  t(subtitle,M+16,19,6.5,'normal','left',_NC.mid);

  // Patient info right
  t('Patient',PW-M,9,5.5,'bold','right',_NC.muted);
  serif(p.name||'—',PW-M,16,9,'right',_NC.dark);
  t('DOB: '+(p.dob||'—')+'   ·   ID: '+(p.dni||'—'),PW-M,21,6,'normal','right',_NC.muted);
  t('Generated: '+_fmtDT(),PW-M,27,5.5,'normal','right',_NC.muted);

  return 38;
}

// ─── Section header ───────────────────────────────────────────
function _sectionHeader(label, y, M, CW, rct, t) {
  rct(M,y,CW,7,_NC.light);
  t(label.toUpperCase(),M+4,y+5,6,'bold','left',_NC.mid);
  return y+10;
}

// ─── Info row ─────────────────────────────────────────────────
function _infoRow(label, value, y, M, t, isLast=false, doc) {
  t(label,M+4,y+4.5,6.5,'normal','left',_NC.muted);
  t(value||'—',M+52,y+4.5,6.5,'bold','left',_NC.dark);
  if (!isLast) { doc.setDrawColor(..._NC.border); doc.setLineWidth(0.15); doc.line(M,y+8,M+174,y+8); }
  return y+8;
}

// ─── Confidence bars ──────────────────────────────────────────
function _confBars(allConf, predicted, y, M, CW, fill, t, doc) {
  const lw=42, bx=M+lw, bw=CW-lw-18;
  _ORDER.forEach(s => {
    const val = _clamp(allConf[s]);
    const sel = s===predicted;
    doc.setFont('helvetica',sel?'bold':'normal'); doc.setFontSize(6.5);
    doc.setTextColor(...(sel?_NC.dark:_NC.muted));
    doc.text(_STAGE[s].label,M,y+3.5);
    fill(_NC.matchaLt); doc.roundedRect(bx,y,bw,4,1.5,1.5,'F');
    if(val>0.005){ fill(_STAGE[s].color); doc.roundedRect(bx,y,bw*val,4,1.5,1.5,'F'); }
    doc.setFont('helvetica',sel?'bold':'normal');
    doc.setTextColor(...(sel?_NC.matchaDk:_NC.muted));
    doc.text((val*100).toFixed(1)+'%',M+CW,y+3.5,{align:'right'});
    y+=7;
  });
  return y+2;
}

// ─── Domain trends table ──────────────────────────────────────
function _domainTable(domains, y, M, CW, rct, t, fill, doc) {
  if (!domains) {
    t('No cognitive exercise data available for this patient.',M,y+5,7,'italic','left',_NC.muted);
    return y+12;
  }
  const colW=[72,52,50];
  // Header row
  rct(M,y,CW,7,_NC.matchaDk);
  t('Cognitive Domain',M+4,y+5,6.5,'bold','left',_NC.white);
  t('Exercise',M+colW[0]+4,y+5,6.5,'bold','left',_NC.white);
  t('Trend',M+colW[0]+colW[1]+4,y+5,6.5,'bold','left',_NC.white);
  y+=7;

  _DOMAINS.forEach((d,i) => {
    const info = domains[d.key];
    const bg   = i%2===0 ? _NC.white : _NC.light;
    rct(M,y,CW,8,bg);
    t(d.label,M+4,y+5.5,6.5,'normal','left',_NC.dark);
    t(d.game,M+colW[0]+4,y+5.5,6.5,'normal','left',_NC.mid);
    if (!info) {
      t('No data',M+colW[0]+colW[1]+4,y+5.5,6.5,'italic','left',_NC.muted);
    } else {
      const trendLabel = info.trend==='improving' ? 'Improving' : info.trend==='declining' ? 'Declining' : 'Stable';
      const trendCol   = info.trend==='improving' ? _NC.stageNone : info.trend==='declining' ? _NC.stageMod : _NC.stageVMild;
      const pillW = 38;
      rct(M+colW[0]+colW[1]+4,y+1.5,pillW,5,trendCol,2);
      t(trendLabel,M+colW[0]+colW[1]+4+pillW/2,y+5.5,6,'bold','center',_NC.white);
      t('('+info.sessions+' session'+(info.sessions!==1?'s':'')+')',M+colW[0]+colW[1]+4+pillW+3,y+5.5,5.5,'normal','left',_NC.muted);
    }
    // row border
    doc.setDrawColor(..._NC.border); doc.setLineWidth(0.15); doc.line(M,y+8,M+CW,y+8);
    y+=8;
  });
  return y+4;
}

// ─── Clinical notes section ───────────────────────────────────
function _notesSection(notes, y, M, CW, rct, t, doc, PH) {
  if (!notes || notes.length === 0) {
    rct(M,y,CW,12,_NC.light,2);
    t('No clinical notes recorded for this patient.',M+5,y+8,6.5,'italic','left',_NC.muted);
    return y+16;
  }
  notes.forEach(n => {
    const lines   = doc.splitTextToSize(n.note||'', CW-12);
    const blockH  = 10 + lines.length * 5;
    if (y+blockH > PH-20) { doc.addPage(); y=18; }
    rct(M,y,3,blockH,_NC.matcha);
    rct(M+3,y,CW-3,blockH,_NC.cream,0,2);
    t(_fmtDT(n.created_at),M+8,y+5,5.5,'normal','left',_NC.muted);
    doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(..._NC.dark);
    doc.text(lines,M+8,y+10);
    y+=blockH+4;
  });
  return y;
}

// ─── Footer ───────────────────────────────────────────────────
function _footer(doc, PW, PH, M, CW) {
  const pages = doc.getNumberOfPages();
  for (let p=1; p<=pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(..._NC.border); doc.setLineWidth(0.25); doc.line(M,PH-14,M+CW,PH-14);
    doc.setFontSize(5.2); doc.setFont('helvetica','italic'); doc.setTextColor(..._NC.muted);
    doc.text('NeuroClass  ·  Universidad de Deusto  ·  Bilbao, Spain  ·  For clinical support only — not a substitute for professional medical diagnosis.',M,PH-9);
    doc.setFont('helvetica','normal');
    doc.text('Page '+p+' of '+pages,M+CW,PH-9,{align:'right'});
  }
}

// ═══════════════════════════════════════════════════════════════
// INDIVIDUAL PREDICTION REPORT
// ═══════════════════════════════════════════════════════════════
async function generateAndUploadReport({
  patient, doctor, prediction, gradcamBase64,
  gameScores, gameSessions, notes, predictionId, supabase
}) {
  const { doc, PW, PH, M, CW, fill, tc, sk, rct, hline, t, serif } = _makePDF();
  const stage = _STAGE[prediction.stage] || _STAGE.NonDemented;
  const conf  = _clamp(prediction.confidence);

  let y = _pageHeader(patient, doc, PW, M, CW, rct, hline, t, serif, 'Clinical Prediction Report  ·  '+_fmt());

  // ── Physician info ───────────────────────────────────────
  y = _sectionHeader('Physician Information', y, M, CW, rct, t);
  y = _infoRow('Physician',doctor.name||'—',y,M,t,false,doc);
  y = _infoRow('ID / Colegiado',doctor.dni||'—',y,M,t,true,doc);
  y+=4;

  // ── Diagnosis ────────────────────────────────────────────
  y = _sectionHeader('Diagnosis', y, M, CW, rct, t);

  // Stage card
  rct(M,y,3,22,stage.color);
  rct(M+3,y,CW-3,22,_NC.light);
  t('PREDICTED STAGE',M+10,y+6,5.5,'bold','left',_NC.muted);
  serif(stage.label,M+10,y+15,11,'left',_NC.dark);
  // Confidence right
  t('CONFIDENCE',PW-M-35,y+6,5.5,'bold','right',_NC.muted);
  serif((conf*100).toFixed(1)+'%',PW-M,y+15,14,'right',_NC.matchaDk);
  t('Report ID: '+predictionId.slice(0,8).toUpperCase(),M+10,y+21,5,'normal','left',_NC.muted);
  y+=26;

  // ── Probability breakdown ────────────────────────────────
  y = _sectionHeader('Classification Probabilities', y, M, CW, rct, t);
  y = _confBars(prediction.allConfidences||{}, prediction.stage, y, M, CW, fill, t, doc);
  y+=2;

  // ── Grad-CAM ─────────────────────────────────────────────
  if (gradcamBase64) {
    y = _sectionHeader('Grad-CAM Activation Map', y, M, CW, rct, t);
    try {
      const src = gradcamBase64.startsWith('data:') ? gradcamBase64 : 'data:image/jpeg;base64,'+gradcamBase64;
      const iW=58, iH=58;
      sk(_NC.border,0.3); doc.roundedRect(M,y,iW,iH,2,2);
      doc.addImage(src,'JPEG',M,y,iW,iH);
      const tx=M+iW+8, tw=CW-iW-8;
      t('Gradient-weighted Class Activation Map',tx,y+7,7,'bold','left',_NC.dark);
      const cap='Highlights the brain regions that most influenced the model\'s prediction for the detected stage. Warmer colours indicate higher activation intensity.';
      doc.setFontSize(6.5); doc.setFont('helvetica','normal'); tc(_NC.muted);
      doc.text(doc.splitTextToSize(cap,tw),tx,y+14);
      t('Predicted class: '+stage.label,tx,y+38,6.5,'normal','left',_NC.mid);
      t('Confidence: '+(conf*100).toFixed(1)+'%',tx,y+45,6.5,'normal','left',_NC.mid);
      y+=iH+6;
    } catch(e){ console.warn('Grad-CAM embed error:',e); y+=2; }
  }

  // ── Cognitive summary ────────────────────────────────────
  if (gameSessions && gameSessions.length > 0) {
    if (y+80 > PH-20) { doc.addPage(); y=18; }
    y = _sectionHeader('Cognitive Assessment Summary', y, M, CW, rct, t);
    const domains = _computeDomains(gameSessions);
    y = _domainTable(domains, y, M, CW, rct, t, fill, doc);
  }

  // ── Clinical notes ───────────────────────────────────────
  if (y+40 > PH-20) { doc.addPage(); y=18; }
  y = _sectionHeader('Clinical Notes', y, M, CW, rct, t);
  y = _notesSection(notes, y, M, CW, rct, t, doc, PH);

  _footer(doc, PW, PH, M, CW);

  // ── Download ─────────────────────────────────────────────
  const filename='NeuroClass_'+patient.dni+'_'+new Date().toISOString().slice(0,10)+'_'+predictionId.slice(0,8)+'.pdf';
  doc.save(filename);

  // ── Upload to Supabase ────────────────────────────────────
  const blob = doc.output('blob');
  const path = patient.id+'/'+predictionId+'.pdf';
  const { error:upErr } = await supabase.storage.from('neuro-reports').upload(path,blob,{contentType:'application/pdf',upsert:true});
  if (upErr) return { success:false, error:upErr };
  const { data:signed, error:urlErr } = await supabase.storage.from('neuro-reports').createSignedUrl(path,31536000);
  if (urlErr) return { success:false, error:urlErr };
  return { success:true, reportUrl:signed.signedUrl, filename };
}


// ═══════════════════════════════════════════════════════════════
// EVOLUTION REPORT
// ═══════════════════════════════════════════════════════════════
async function generateEvolutionReport({ patient, doctor, predictions, gameSessions, notes, supabase }) {
  const { doc, PW, PH, M, CW, fill, tc, sk, rct, hline, t, serif } = _makePDF();
  const sorted = [...predictions].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));

  let y = _pageHeader(
    patient, doc, PW, M, CW, rct, hline, t, serif,
    'Evolution Report  ·  '+sorted.length+' prediction'+(sorted.length!==1?'s':'')+
    '  ·  '+_fmt(sorted[0]?.created_at)+' – '+_fmt(sorted[sorted.length-1]?.created_at)
  );

  // ── Physician ────────────────────────────────────────────
  y = _sectionHeader('Physician Information', y, M, CW, rct, t);
  y = _infoRow('Physician',doctor.name||'—',y,M,t,false,doc);
  y = _infoRow('ID / Colegiado',doctor.dni||'—',y,M,t,true,doc);
  y+=4;

  // ── Staging evolution summary ─────────────────────────────
  if (sorted.length>=2) {
    y = _sectionHeader('Staging Evolution', y, M, CW, rct, t);
    const first=_STAGE[sorted[0].predicted_class]||_STAGE.NonDemented;
    const last =_STAGE[sorted[sorted.length-1].predicted_class]||_STAGE.NonDemented;
    const fi=first.idx, li=last.idx;
    const trendLabel = li>fi?'Worsening':li<fi?'Improving':'Stable';
    const trendCol   = li>fi?_NC.stageMod:li<fi?_NC.stageNone:_NC.stageVMild;

    rct(M,y,CW,32,_NC.light);
    // First stage pill
    rct(M+4,y+5,58,10,first.color,3);
    t(first.label,M+4+29,y+11,6.5,'bold','center',_NC.white);
    t(_fmt(sorted[0].created_at),M+4+29,y+19,5.5,'normal','center',_NC.muted);
    // Arrow
    t('->',PW/2,y+12,10,'bold','center',_NC.border);
    // Last stage pill
    rct(PW-M-62,y+5,58,10,last.color,3);
    t(last.label,PW-M-62+29,y+11,6.5,'bold','center',_NC.white);
    t(_fmt(sorted[sorted.length-1].created_at),PW-M-62+29,y+19,5.5,'normal','center',_NC.muted);
    // Trend badge below pills, centered
    const tw=54;
    rct(M+CW/2-tw/2,y+23,tw,8,trendCol,3);
    t(trendLabel,M+CW/2,y+28.5,7,'bold','center',_NC.white);
    y+=38;
  }

  // ── Prediction history ────────────────────────────────────
  y = _sectionHeader('Prediction History', y, M, CW, rct, t);

  for (let i=0; i<sorted.length; i++) {
    const r    = sorted[i];
    const meta = _STAGE[r.predicted_class]||_STAGE.NonDemented;
    const conf = _clamp(r.confidence);
    const hasImg = !!(r.mri_url||r.gradcam_url);
    const blockH = hasImg ? 80 : 50;
    if (y+blockH > PH-22) { doc.addPage(); y=18; }

    // Row header
    rct(M,y,CW,9,i%2===0?_NC.white:_NC.light);
    fill(meta.color); doc.circle(M+5,y+4.5,3,'F');
    t(_fmt(r.created_at),M+11,y+6,7,'bold','left',_NC.dark);
    t(meta.label,M+55,y+6,6.5,'normal','left',meta.color);
    t((conf*100).toFixed(1)+'% confidence',M+CW,y+6,7,'bold','right',_NC.matchaDk);
    y+=11;

    // Confidence bars
    const allConf={
      NonDemented:      r.prob_non_demented,
      VeryMildDemented: r.prob_very_mild,
      MildDemented:     r.prob_mild,
      ModerateDemented: r.prob_moderate,
    };
    y = _confBars(allConf,r.predicted_class,y,M,CW,fill,t,doc);

    // Images
    if (hasImg) {
      y+=2;
      const iW=55, iH=55;
      let ix=M;
      for (const [urlKey,lbl] of [['mri_url','MRI'],['gradcam_url','Grad-CAM']]) {
        if (!r[urlKey]) continue;
        try {
          const res  = await fetch(r[urlKey]);
          const blob = await res.blob();
          const b64  = await new Promise(res2=>{ const rd=new FileReader(); rd.onload=()=>res2(rd.result); rd.readAsDataURL(blob); });
          sk(_NC.matchaLt,0.3); doc.roundedRect(ix,y,iW,iH,2,2);
          doc.addImage(b64,'JPEG',ix,y,iW,iH);
          t(lbl,ix+iW/2,y+iH+4,5.5,'normal','center',_NC.muted);
          ix+=iW+6;
        } catch(e){ console.warn(lbl+' error:',e); }
      }
      y+=iH+10;
    }

    // Divider
    if (i<sorted.length-1) {
      sk(_NC.matchaLt,0.2); doc.line(M,y,M+CW,y);
      y+=5;
    }
  }

  // ── Cognitive summary ─────────────────────────────────────
  if (gameSessions && gameSessions.length > 0) {
    if (y+80 > PH-22) { doc.addPage(); y=18; }
    y = _sectionHeader('Cognitive Assessment Summary', y, M, CW, rct, t);
    const domains = _computeDomains(gameSessions);
    y = _domainTable(domains, y, M, CW, rct, t, fill, doc);
  }

  // ── Clinical notes ────────────────────────────────────────
  if (y+40 > PH-22) { doc.addPage(); y=18; }
  y = _sectionHeader('Clinical Notes', y, M, CW, rct, t);
  y = _notesSection(notes, y, M, CW, rct, t, doc, PH);

  _footer(doc, PW, PH, M, CW);

  const filename='NeuroClass_Evolution_'+patient.dni+'_'+new Date().toISOString().slice(0,10)+'.pdf';
  doc.save(filename);
}